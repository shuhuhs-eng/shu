import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/guard";
import { looseRpc } from "@/lib/diagnosis-limit/rpc";
import { classifyFind } from "@/lib/email/outbox-search";
import { fmtJst, OpsEmpty, PageHead } from "@/components/admin/operations-ui";
import { emailOutboxAction, setEmailEnabledAction } from "./actions";

type SP = Promise<Record<string, string | string[] | undefined>>;
type Problem = {
  id: string; status: string; mail_kind: string; template_key: string; attempts: number; last_error: string | null; cancel_requested_at: string | null;
  created_at: string; last_attempt_at: string | null; notification_type: string | null; notified_at: string | null;
  recipient_label: string | null; store_name: string | null; target_path: string | null; late_results: number;
  provider_message_id?: string | null; attempt_short?: string | null;
};
type Missing = { notification_id: string; type: string; created_at: string };
type Action = { action: string; basis: string | null; note: string | null; created_at: string; attempt_short?: string | null; provider_message_id?: string | null };
type Found = { id: string; status: string; mail_kind: string; template_key: string; attempts: number; created_at: string; sent_at: string | null; provider_message_id: string | null; attempt_short: string | null; notification_type: string | null; recipient_label: string | null };
type Overview = { enabled_from: string | null; counts: Record<string, number>; problems: Problem[]; missing: Missing[]; recent_actions: Action[]; unrouted_replies?: number };

const STATUS_LABEL: Record<string, string> = { pending: "送信待ち", processing: "処理中", sent: "送信済み", failed: "失敗", unknown: "結果不明", bounced: "受理後の不達（自動再送しない）", cancelled: "取消済み（送らない）", held: "保留（確認待ち）" };
const KIND_LABEL: Record<string, string> = { notice: "お知らせ", cancel_correction: "取消の訂正連絡" };
const ACTION_LABEL: Record<string, string> = {
  enable: "メール通知を開始", disable: "メール通知を停止", enqueue_missing: "積み漏れを送信待ちにした", enqueue_missing_noop: "積み漏れの操作（すでに送信待ち）",
  requeue: "再処理", mark_delivered: "受理・到着を記録（送信済みにした）", mark_not_delivered: "「受理されていない」と判断", mark_undeliverable: "「受理後に不達」と記録", annotate: "経過を記録",
};
const BASIS_LABEL: Record<string, string> = {
  provider_accepted: "送信サービスが受理（受信箱への到着は未確認）", inbox_confirmed: "受信箱への到着を確認",
  provider_not_accepted: "送信サービスに受理の記録が無い", provider_bounced: "受理後に不達（バウンス）の記録がある", provider_rejected: "送信サービスが受理後に拒否した記録がある",
  provider_delayed: "配信遅延の可能性（確認中）", checking: "送信サービスへ確認中",
};
const TYPE_LABEL: Record<string, string> = {
  stylist_interest_received: "見学・体験入店の希望", scout_received: "スカウト", scout_responded: "スカウトへの返信", message_received: "運営との連絡",
  salary_offer_received: "条件の提示", salary_offer_revised: "条件の再提示", salary_offer_accepted: "条件の承諾", salary_offer_revision_requested: "条件の相談", salary_offer_declined: "条件の辞退",
  evidence_verified: "実績の確認", evidence_rejected: "実績の確認", interview_action_required: "面接の要対応", age_disclosure_requested: "年齢開示の依頼", age_disclosure_approved: "年齢開示の承認",
  hiring_interview_scheduled: "面接の予定", hiring_interview_rescheduled: "面接の変更", hiring_status_updated: "進捗", hiring_offered: "進捗", hiring_hired: "採用", hiring_declined_by_stylist: "辞退",
};
const DAY_MS = 24 * 60 * 60 * 1000;

/** 運営: 通知メールの送信状況（失敗・結果不明・保留・積み漏れ）と再処理。宛先のメールアドレスは表示しない。 */
export default async function AdminEmailOutboxPage({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireAdminPage("/admin/email-outbox");
  const sp = await searchParams;
  const r = typeof sp.r === "string" ? sp.r : "";
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 200) : "";
  const { data, error } = await looseRpc(supabase).rpc("admin_email_outbox_overview", { p_limit: 50 });
  const ov = (error ? null : data) as Overview | null;
  // 送信済みメールの特定（送信待ちID／送信サービスの照合IDの完全一致のみ。全件は出さない）
  const found = q.length >= 8 ? await looseRpc(supabase).rpc("admin_email_outbox_find", { p_query: q }) : null;
  // 検索の失敗（RPCエラー）と、正常な0件を分ける。失敗を「該当なし」と表示しない
  const fr = classifyFind<Found>(found);
  const findFailed = fr?.failed === true;
  const foundRows = fr?.rows ?? [];
  const btn = "min-h-[40px] rounded-full border border-line bg-surface px-4 text-[12px] font-semibold text-ink";
  const sel = "min-h-[40px] rounded-lg border border-line bg-surface px-2 text-[12px] text-ink";
  const nowMs = new Date().getTime();
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <PageHead title="通知メールの送信状況" lead={<>登録メールへの通知の送信状況です。<b>結果不明</b>は、外部サービスに渡したあとで届いたか確認できなかったものです。<b>受理後の不達（バウンス）</b>は「受理されていない」とは別で、同じ内容を自動では再送しません。下の根拠を確認して判断してください。宛先のメールアドレスは表示しません。</>} />
      {r === "ok" && <p role="status" className="mt-4 rounded-lg bg-surface2 px-3 py-2 text-[12px] text-charcoal">操作を反映しました。</p>}
      {(r === "failed" || r === "invalid") && <p role="alert" className="mt-4 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">操作できませんでした（権限・状態・根拠の選択を確認してください）。</p>}
      {!ov ? <OpsEmpty>送信状況を取得できませんでした。</OpsEmpty> : (
        <>
          <section className="mt-6 rounded-2xl border border-line bg-surface p-4">
            <h2 className="font-serif text-[15px] font-bold text-ink">メール通知の開始・停止</h2>
            <p data-testid="enabled-state" className="mt-1 text-[12.5px] text-charcoal">{ov.enabled_from ? `開始済み（${fmtJst(ov.enabled_from)} 以降に作られた通知から対象）` : "未開始（通知メールは1通も積まれません）"}</p>
            <p className="mt-1 text-[11.5px] text-sub">停止すると、取り出し済みで未送信のものも送信直前に止まります（すでに外部サービスへ渡した1通は止められません）。停止・再開は操作履歴に残ります。</p>
            <form action={setEmailEnabledAction} className="mt-3 flex flex-wrap items-center gap-3">
              <input type="hidden" name="enable" value={ov.enabled_from ? "0" : "1"} />
              <label className="flex items-center gap-2 text-[12px] text-sub"><input type="checkbox" name="confirm" value="yes" required />{ov.enabled_from ? "停止する（過去の通知は遡って送りません）" : "開始する（過去の通知は送りません。開始後に作られる通知から対象）"}</label>
              <button className={btn}>{ov.enabled_from ? "停止" : "開始"}</button>
            </form>
          </section>
          {(ov.unrouted_replies ?? 0) > 0 && <p data-testid="unrouted-replies" role="status" className="mt-4 rounded-lg bg-surface2 px-3 py-2 text-[12px] text-charcoal">通知先になる運営担当者がいなかった返信が {ov.unrouted_replies} 件あります（運営の受信箱には残っています）。運営の担当者（権限・アカウント）を確認してください。</p>}
          <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
            <h2 className="font-serif text-[15px] font-bold text-ink">件数</h2>
            <ul className="mt-2 flex flex-wrap gap-2 text-[12px]">
              {Object.keys(STATUS_LABEL).map((k) => <li key={k} data-testid={`count-${k}`} className="rounded-full bg-surface2 px-3 py-1 text-charcoal">{STATUS_LABEL[k]} {ov.counts[k] ?? 0}</li>)}
            </ul>
          </section>
          <section className="mt-4">
            <h2 className="font-serif text-[15px] font-bold text-ink">要確認（失敗・結果不明・保留・滞留）</h2>
            {ov.problems.length === 0 ? <OpsEmpty>要確認のものはありません。</OpsEmpty> : (
              <ul className="mt-2 space-y-3">
                {ov.problems.map((p) => {
                  const old = p.last_attempt_at ? nowMs - new Date(p.last_attempt_at).getTime() > DAY_MS : false;
                  return (
                  <li key={p.id} data-testid="problem-row" className="rounded-2xl border border-line bg-surface p-4 text-[12.5px] text-charcoal">
                    <div className="flex flex-wrap gap-2"><span className="rounded-full bg-surface2 px-2 py-0.5 font-semibold">{STATUS_LABEL[p.status] ?? p.status}</span><span>{KIND_LABEL[p.mail_kind] ?? p.mail_kind}</span><span className="text-sub">{p.notification_type ? (TYPE_LABEL[p.notification_type] ?? p.notification_type) : "（元の通知は削除済み）"}</span></div>
                    <p data-testid="problem-who" className="mt-1">宛先: <b>{p.recipient_label ?? "不明"}</b>{p.store_name ? ` ／ 店舗: ${p.store_name}` : ""}{p.target_path ? <> ／ <Link href={p.target_path} className="underline">対象を開く</Link></> : null}</p>
                    <p className="mt-1 text-sub">作成 {fmtJst(p.created_at)}{p.last_attempt_at ? ` ／ 最後の試行 ${fmtJst(p.last_attempt_at)}` : ""} ／ 試行 {p.attempts}回{p.last_error ? ` ／ 理由 ${p.last_error}` : ""}{p.cancel_requested_at ? " ／ 送信中に取消あり" : ""}{p.attempt_short ? ` ／ 対象の試行 ${p.attempt_short}` : ""}{p.provider_message_id ? ` ／ 送信サービスの照合ID ${p.provider_message_id}` : ""}{p.late_results > 0 ? ` ／ 古い試行の遅い結果を${p.late_results}件受信（反映せず記録のみ）` : ""}</p>
                    {p.status === "unknown" && (
                      <div className="mt-2 rounded-lg bg-surface2 p-3 text-[11.5px] text-charcoal">
                        <p>判断の根拠: 送信サービスの記録（受理の有無・拒否・不達）か、宛先の受信箱での到着確認。<b>受信箱に見当たらないだけでは「受理されていない」とは判断できません</b>（迷惑メール・遅延・不達の可能性）。根拠が確認できないときは判断せず保留してください。</p>
                        {old && <p className="mt-1 font-semibold text-[#8A2E2E]">最後の試行から24時間以上経過しています。送信サービスの重複防止の期間（24時間）を過ぎているため、「受理されていない」として再送すると二重送信になる可能性があります。送信サービス側の記録を必ず確認してください。</p>}
                      </div>
                    )}
                    <form action={emailOutboxAction} className="mt-2 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={p.id} />
                      {p.status === "failed" && <button name="action" value="requeue" className={btn}>再処理する</button>}
                      {p.status === "unknown" && (
                        <>
                          <select name="basis" aria-label="判断の根拠" defaultValue="" className={sel}>
                            <option value="">根拠を選択</option>
                            <optgroup label="受理・到着（送信済みにする）">
                              <option value="provider_accepted">{BASIS_LABEL.provider_accepted}</option>
                              <option value="inbox_confirmed">{BASIS_LABEL.inbox_confirmed}</option>
                            </optgroup>
                            <optgroup label="受理されていない（再送してよい）">
                              <option value="provider_not_accepted">{BASIS_LABEL.provider_not_accepted}</option>
                            </optgroup>
                            <optgroup label="受理後に不達（自動では再送しない）">
                              <option value="provider_bounced">{BASIS_LABEL.provider_bounced}</option>
                              <option value="provider_rejected">{BASIS_LABEL.provider_rejected}</option>
                            </optgroup>
                            <optgroup label="経過の記録だけ（状態は変えない）">
                              <option value="provider_delayed">{BASIS_LABEL.provider_delayed}</option>
                              <option value="checking">{BASIS_LABEL.checking}</option>
                            </optgroup>
                          </select>
                          <input name="note" maxLength={200} placeholder="メモ（任意・200字まで。個人情報は書かない）" className={`${sel} min-w-[220px]`} />
                          <input name="provider_ref" maxLength={200} placeholder="送信サービスの照合ID（任意）" className={`${sel} min-w-[180px]`} />
                          <button name="action" value="mark_delivered" className={btn}>受理・到着を記録</button>
                          <button name="action" value="mark_not_delivered" className={btn}>受理されていない（再送）</button>
                          <button name="action" value="mark_undeliverable" className={btn}>受理後に不達が確定</button>
                          <button name="action" value="annotate" className={btn}>経過を記録</button>
                        </>
                      )}
                      {p.status === "bounced" && <p className="text-[11.5px] text-sub">受理後の不達として確定済みです。同じ内容は自動では再送しません。宛先の登録メールを本人に確認してから、必要なら新しい通知として対応してください。</p>}
                      {p.status === "held" && <p className="text-[11.5px] text-sub">元のメールの結果が分かると、送る／止めるが自動で決まります（上の「結果不明」を先に処理してください）。</p>}
                    </form>
                  </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
            <h2 className="font-serif text-[15px] font-bold text-ink">送信済みメールの確認・不達の記録</h2>
            <p className="mt-1 text-[11.5px] text-sub">送信サービス側で後日「受理後に不達」と分かったメールは、送信待ちID または 送信サービスの照合ID（完全一致）で探して記録します。送信済みを「未受理」として戻すことはできません。</p>
            <form method="get" className="mt-2 flex flex-wrap items-center gap-2">
              <input name="q" defaultValue={q} minLength={8} maxLength={200} placeholder="送信待ちID または 照合ID" aria-label="送信待ちID または 照合ID" className={`${sel} min-w-[260px]`} />
              <button className={btn}>探す</button>
            </form>
            {findFailed && <p data-testid="find-error" role="alert" className="mt-2 text-[12px] text-[#8A2E2E]">検索結果を取得できませんでした。時間をおいて再検索してください。（検索語は保持しています）</p>}
            {q.length >= 8 && !findFailed && foundRows.length === 0 && <p data-testid="find-empty" className="mt-2 text-[12px] text-sub">該当するメールが見つかりません（完全一致のみ）。</p>}
            {foundRows.map((f) => (
              <div key={f.id} data-testid="found-row" className="mt-2 rounded-xl bg-surface2 p-3 text-[12.5px] text-charcoal">
                <div className="flex flex-wrap gap-2"><span className="rounded-full bg-surface px-2 py-0.5 font-semibold">{STATUS_LABEL[f.status] ?? f.status}</span><span>{KIND_LABEL[f.mail_kind] ?? f.mail_kind}</span><span className="text-sub">{f.notification_type ? (TYPE_LABEL[f.notification_type] ?? f.notification_type) : "（元の通知は削除済み）"}</span></div>
                <p className="mt-1">宛先: <b>{f.recipient_label ?? "不明"}</b> ／ 送信待ちID {f.id}{f.sent_at ? ` ／ 送信 ${fmtJst(f.sent_at)}` : ""}{f.attempt_short ? ` ／ 試行 ${f.attempt_short}` : ""}{f.provider_message_id ? ` ／ 照合ID ${f.provider_message_id}` : ""}</p>
                {f.status === "sent" && (
                  <form action={emailOutboxAction} className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={f.id} /><input type="hidden" name="action" value="mark_undeliverable" />
                    <select name="basis" aria-label="不達の根拠" defaultValue="" required className={sel}>
                      <option value="">根拠を選択</option>
                      <option value="provider_bounced">{BASIS_LABEL.provider_bounced}</option>
                      <option value="provider_rejected">{BASIS_LABEL.provider_rejected}</option>
                    </select>
                    <input name="provider_ref" maxLength={200} placeholder="送信サービスの照合ID（任意）" className={`${sel} min-w-[180px]`} />
                    <input name="note" maxLength={200} placeholder="メモ（任意・200字まで。個人情報は書かない）" className={`${sel} min-w-[220px]`} />
                    <button className={btn}>受理後に不達と記録</button>
                  </form>
                )}
              </div>
            ))}
          </section>
          <section className="mt-4">
            <h2 className="font-serif text-[15px] font-bold text-ink">積み漏れ（通知はあるが、メールの送信待ちが無い）</h2>
            {ov.missing.length === 0 ? <OpsEmpty>積み漏れはありません。</OpsEmpty> : (
              <ul className="mt-2 space-y-3">
                {ov.missing.map((m) => (
                  <li key={m.notification_id} data-testid="missing-row" className="rounded-2xl border border-line bg-surface p-4 text-[12.5px] text-charcoal">
                    <span className="font-semibold">{TYPE_LABEL[m.type] ?? m.type}</span> <span className="text-sub">{fmtJst(m.created_at)}</span>
                    <form action={emailOutboxAction} className="mt-2"><input type="hidden" name="id" value={m.notification_id} /><button name="action" value="enqueue_missing" className={btn}>送信待ちにする</button></form>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="mt-4">
            <h2 className="font-serif text-[15px] font-bold text-ink">最近の操作履歴</h2>
            {ov.recent_actions.length === 0 ? <OpsEmpty>操作履歴はまだありません。</OpsEmpty> : (
              <ul data-testid="recent-actions" className="mt-2 space-y-1 text-[12px] text-charcoal">
                {ov.recent_actions.map((a, i) => <li key={i} className="rounded-lg bg-surface px-3 py-2">{fmtJst(a.created_at)} ／ {ACTION_LABEL[a.action] ?? a.action}{a.basis ? `（根拠: ${BASIS_LABEL[a.basis] ?? a.basis}）` : ""}{a.attempt_short ? ` ／ 試行 ${a.attempt_short}` : ""}{a.provider_message_id ? ` ／ 照合ID ${a.provider_message_id}` : ""}{a.note ? ` ／ メモ: ${a.note}` : ""}</li>)}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
