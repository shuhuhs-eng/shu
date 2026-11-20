import { looseRpc } from "@/lib/diagnosis-limit/rpc";
import type { MailProvider } from "./provider";
import { buildLink, renderMail } from "./templates";

type Claimed = { outbox_id: string; attempt_id: string; mail_kind: string; template_key: string; link_path: string | null; attempts: number };
type Confirmed = { ok: boolean; reason: string; recipient_email: string | null; notified_at: string | null };
export type WorkerResult = {
  claimed: number; sent: number; retried: number; rejected: number; unknown: number;
  skippedCancelled: number;   // 取消・宛先不可・受信権限なしなどで、送信直前の確認が止めた
  skippedDisabled: number;    // 停止中（取り出し後に停止された）で、外部送信を始めなかった
  stale: number;              // 結果の記録が「古い試行」として反映されなかった
  deferred: number;           // 時間予算が足りず、今回は触れなかった（リース期限後に再取得される）
  released: number;           // 送信直前の確認の後で時間が足りなくなり、外部送信せず待ちへ戻した
  releaseFailed: number;      // 待ちへ戻す記録ができなかった（送信開始の記録が残るため、期限後は「結果不明」として運営が確認する。再送はしない）
  batches: number;
};

/** 1通の外部送信の最長（provider のHTTPタイムアウトと揃える）。 */
export const SEND_TIMEOUT_MS = 15_000;
/** 1回の実行で使う時間の上限。外部スケジューラ／関数の実行時間上限（route の maxDuration=60秒）より短くする。 */
export const DEFAULT_BUDGET_MS = 50_000;
/** 1回の取り出し件数。20件×15秒＝300秒が実行時間やリース(120秒)を超えないよう小さくする。 */
export const BATCH_SIZE = 5;
export const LEASE_SECONDS = 120;

/**
 * 送信ワーカー1回分。DB側の関数（service_role専用）だけを使う:
 *   1) email_outbox_claim … 送信待ちを小バッチ（既定5件）で取り出す。各行に「試行の識別子（attempt_id）」が付く
 *   2) email_outbox_confirm_send … 送信直前に、停止・取消・宛先（いまの登録メール・確認済み・利用停止でない）・受信権限を再確認し、
 *        OKのときだけ「いま」の宛先メールを返す。ここで送信開始が記録される
 *   3) 送信 → 4) email_outbox_finish … 試行の識別子つきで結果を記録（sent / retry / rejected / unknown）。
 *        古い試行の結果はDB側が反映せず stale を返す
 * ★業務処理（希望の送信・取消）はここに依存しない。
 * ★時間予算: 新しい外部送信は「残り時間 ≥ 1通の最長(15秒)」のときだけ始める。確認の前と、確認の戻り「後」の2回確かめる
 *   （確認RPCが遅れて残りが足りなくなったら、外部送信せず email_outbox_release で安全に待ちへ戻す）。
 *   最悪の長さ: 予算50秒の時点で新しい送信を始めない → 送信の最長は予算の終端(≤50秒)で終わる → 結果の記録(finish)に使える余裕は route の
 *   maxDuration(60秒) までの10秒。確認前に足りない場合は、取り出し済みの行をリース期限(120秒)後にDB側で待ちへ戻す（外部送信前なので二重送信にならない）。
 * ★finish が記録できなかった場合は何もしない（処理中のまま期限切れ→「結果不明」として運営が確認する。勝手に再送しない）。
 */
export async function runEmailWorker(opts: {
  client: unknown; provider: MailProvider; workerId: string; siteUrl: string;
  batchSize?: number; budgetMs?: number; now?: () => number;
}): Promise<WorkerResult> {
  const rpc = looseRpc(opts.client);
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  const batch = Math.min(Math.max(opts.batchSize ?? BATCH_SIZE, 1), 20);
  const out: WorkerResult = { claimed: 0, sent: 0, retried: 0, rejected: 0, unknown: 0, skippedCancelled: 0, skippedDisabled: 0, stale: 0, deferred: 0, released: 0, releaseFailed: 0, batches: 0 };
  const finish = async (row: Claimed, outcome: "sent" | "retry" | "rejected" | "unknown", messageId: string | null, err: string | null) => {
    const r = await rpc.rpc("email_outbox_finish", { p_id: row.outbox_id, p_attempt: row.attempt_id, p_outcome: outcome, p_provider_message_id: messageId, p_error: err });
    if (r.error) { console.error("[mail-worker] finish failed", { id: row.outbox_id, code: r.error.code }); return; }
    if (r.data === "stale" || r.data === "late_ignored") out.stale++;
  };
  let disabled = false;
  while (!disabled && now() + SEND_TIMEOUT_MS <= deadline) {
    const { data, error } = await rpc.rpc("email_outbox_claim", { p_worker: opts.workerId, p_limit: batch, p_lease_seconds: LEASE_SECONDS });
    if (error) { if (out.batches === 0) throw new Error(`claim_failed:${error.code ?? ""}`); break; }
    const rows = (Array.isArray(data) ? data : []) as Claimed[];
    if (rows.length === 0) break;
    out.batches++; out.claimed += rows.length;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (now() + SEND_TIMEOUT_MS > deadline) { out.deferred += rows.length - i; break; }
      const link = buildLink(opts.siteUrl, row.link_path);
      // 文面・リンクが作れない行は、送信直前の確認（送信開始の記録）より前に「受け付けられない」として終える
      if (!link || !renderMail(row.template_key, link)) { await finish(row, "rejected", null, link ? "unknown_template" : "bad_link_or_site_url"); out.rejected++; continue; }
      const c = await rpc.rpc("email_outbox_confirm_send", { p_id: row.outbox_id, p_attempt: row.attempt_id });
      if (c.error) { console.error("[mail-worker] confirm failed", { id: row.outbox_id, code: c.error.code }); continue; }
      const conf = (Array.isArray(c.data) ? c.data[0] : c.data) as Confirmed | undefined;
      if (!conf?.ok || !conf.recipient_email) {
        // 停止中: この行は待ちへ戻される。同じバッチの残りも、次の確認で同じ判定になる（外部送信は始めない）
        if (conf?.reason === "disabled") { out.skippedDisabled++; disabled = true; } else if (conf?.reason !== "not_current_attempt") out.skippedCancelled++;
        continue;
      }
      // 確認RPCが遅れて残り時間が足りなくなっていたら、外部送信を始めない。この試行を待ちへ戻す（送信開始の記録も消える）
      if (now() + SEND_TIMEOUT_MS > deadline) {
        const rel = await rpc.rpc("email_outbox_release", { p_id: row.outbox_id, p_attempt: row.attempt_id });
        if (rel.error || (rel.data !== "released" && rel.data !== "stale")) { console.error("[mail-worker] release failed", { id: row.outbox_id, code: rel.error?.code ?? null }); out.releaseFailed++; }
        else if (rel.data === "released") out.released++;
        out.deferred += rows.length - i - 1; break;
      }
      // 取消の訂正連絡の文面に使う「元の通知の日時」は確認の戻り値から得るため、文面は確認後に作る
      const mail = renderMail(row.template_key, link, { notifiedAt: conf.notified_at });
      if (!mail) { await finish(row, "rejected", null, "unknown_template"); out.rejected++; continue; }
      let res;
      try { res = await opts.provider.send({ to: conf.recipient_email, subject: mail.subject, text: mail.text, idempotencyKey: row.outbox_id }); }
      catch { res = { kind: "unknown" as const, error: "provider_exception" }; }
      if (res.kind === "sent") { await finish(row, "sent", res.messageId, null); out.sent++; }
      else { await finish(row, res.kind, null, res.error); out[res.kind === "retry" ? "retried" : res.kind === "rejected" ? "rejected" : "unknown"]++; }
    }
  }
  return out;
}
