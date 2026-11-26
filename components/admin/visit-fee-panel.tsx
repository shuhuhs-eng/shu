"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelVisitFee, finishVisitFeeAttempt, resolveVisitFeeUnknown, startVisitFeePayment } from "@/lib/billing/visit-fee-actions";
import { canApplyFee, FEE_STATUS_LABELS, type FeeStatus } from "@/lib/billing/event-fee";

export type FeeView = { charge: { id: string; status: FeeStatus; fee_amount: number; tax_amount: number; total_amount: number }; attempts: { id: string; attempt_no: number; status: string; external_ref: string | null; idempotency_key: string }[] };
const btn = "min-h-[44px] rounded-full bg-ink px-5 text-[13px] font-semibold text-white disabled:opacity-50";
const inp = "min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 text-[13px]";
const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

/**
 * 責任者のみ。★この画面は「外部で行った決済の結果を記録する」もので、ボタンを押してもカード請求・送金は行われません。
 * 手順（提案・運営方針の確認待ち）: ①「決済の記録を開始」で記録番号を発行 → ②運営が決済サービス（Stripeダッシュボード等）で、
 * 登録カードへ税込の金額を請求し、記録番号を摘要・メタデータに入れる → ③結果（参照ID）をここへ記録。結果が分からないときは入金を確認してから記録します。
 */
export function VisitFeePanel({ fee }: { fee: FeeView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const [ref, setRef] = useState(""); const [reason, setReason] = useState(""); const [note, setNote] = useState("");
  const c = fee.charge; const open = fee.attempts.find((a) => a.status === "in_progress" || a.status === "unknown");
  async function run(f: () => Promise<{ success: boolean; error?: string }>) {
    if (busy) return; setBusy(true); setMsg(null);
    try { const r = await f(); setMsg(r.success ? "記録しました。" : r.error ?? "処理を完了できませんでした。"); if (r.success) router.refresh(); }
    catch { setMsg("通信に失敗しました。結果が不明です。画面を読み込み直して状態を確認してください（確認なしに再操作しないでください）。"); }
    finally { setBusy(false); }
  }
  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-4" aria-label="見学・体験入店の料金">
      <h2 className="text-[14px] font-semibold">料金の決済記録（責任者のみ）</h2>
      <p className="mt-1 text-[12.5px] text-sub">税抜 {yen(c.fee_amount)} ＋ 税 {yen(c.tax_amount)} ＝ {yen(c.total_amount)}　状態: <b>{FEE_STATUS_LABELS[c.status]}</b></p>
      <p className="mt-2 rounded-xl bg-surface2 p-3 text-[12px] text-sub">この画面のボタンでは<b>カード請求・送金は行われません</b>。決済は運営が外部（決済サービスの管理画面など）で行い、その<b>結果をここへ記録</b>します。</p>
      {c.status === "payment_unknown" && <p role="alert" className="mt-2 text-[12.5px] font-semibold text-[#8A2E2E]">前回の決済結果が不明です。入金の有無を確認して記録するまで、新しい決済は始められません。</p>}
      {c.status === "payment_failed" && <p role="status" className="mt-2 text-[12.5px] text-[#8A2E2E]">決済に失敗しました。再試行の条件が決まるまで、この請求から新しい決済は始められません（取消のみ可能）。</p>}
      <div className="mt-3 space-y-2">
        {canApplyFee(c.status, "start_payment", true).ok && <button className={btn} disabled={busy} onClick={() => run(() => startVisitFeePayment({ chargeId: c.id }))}>決済の記録を開始する（請求はされません）</button>}
        {c.status === "payment_in_progress" && open && (<>
          <p className="text-[12px] text-sub">記録番号（外部決済の摘要・メタデータに入れてください）: <code className="select-all">{open.idempotency_key}</code></p>
          <input className={inp} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="決済の参照ID（支払い済みとして記録する場合は必須）" />
          <div className="flex flex-wrap gap-2">
            <button className={btn} disabled={busy || !ref.trim()} onClick={() => run(() => finishVisitFeeAttempt({ attemptId: open.id, result: "succeeded", externalRef: ref }))}>支払い済みとして記録</button>
            <button className={btn} disabled={busy} onClick={() => run(() => finishVisitFeeAttempt({ attemptId: open.id, result: "failed" }))}>失敗として記録</button>
            <button className={btn} disabled={busy} onClick={() => run(() => finishVisitFeeAttempt({ attemptId: open.id, result: "unknown" }))}>結果が分からない</button>
          </div></>)}
        {c.status === "payment_unknown" && open && (<>
          <input className={inp} value={note} onChange={(e) => setNote(e.target.value)} placeholder="確認内容（必須。どこで・どう入金の有無を確認したか）" />
          <input className={inp} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="入金を確認した場合の参照ID" />
          <div className="flex flex-wrap gap-2">
            <button className={btn} disabled={busy || !ref.trim() || !note.trim()} onClick={() => run(() => resolveVisitFeeUnknown({ attemptId: open.id, paid: true, externalRef: ref, note }))}>入金を確認した</button>
            <button className={btn} disabled={busy || !note.trim()} onClick={() => run(() => resolveVisitFeeUnknown({ attemptId: open.id, paid: false, note }))}>入金がないことを確認した</button>
          </div></>)}
        {canApplyFee(c.status, "cancel", true).ok && (<>
          <input className={inp} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="取消の理由（実施されなかったと判明した場合など）" />
          <button className={btn} disabled={busy || !reason.trim()} onClick={() => run(() => cancelVisitFee({ chargeId: c.id, reason }))}>請求を取消する</button></>)}
      </div>
      {msg && <p role="status" className="mt-2 text-[12.5px] text-charcoal">{msg}</p>}
    </section>
  );
}
