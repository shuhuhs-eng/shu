"use client";

import { useState } from "react";
import { adminUpdateSuccessFeeAction } from "@/lib/billing/actions";
import { availableFeeActions, feeStatusLabel, formatYen, parseYenInput } from "@/lib/billing/format";
import type { AdminSuccessFee, SuccessFeeAction } from "@/lib/billing/types";
import { BaselineSummary } from "@/components/contracts/baseline-summary";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });
}

export function SuccessFeeCard({ fee }: { fee: AdminSuccessFee }) {
  const [feeInput, setFeeInput] = useState(fee.fee_amount === null ? "" : String(fee.fee_amount));
  const [taxInput, setTaxInput] = useState(fee.tax_amount === null ? "" : String(fee.tax_amount));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const actions = availableFeeActions(fee.fee_status);
  const canEditAmount = actions.includes("confirm");
  const needsReason = (a: SuccessFeeAction) => a === "waive" || a === "cancel";

  async function run(action: SuccessFeeAction) {
    setMessage(null);
    let feeAmount: number | null = null;
    let taxAmount: number | null = null;
    if (action === "confirm") {
      feeAmount = parseYenInput(feeInput);
      taxAmount = parseYenInput(taxInput);
      if (feeAmount === null || taxAmount === null) {
        setMessage("成功報酬額と税額は、0以上の整数（円）で入力してください。");
        return;
      }
    }
    if (needsReason(action) && !note.trim()) {
      setMessage("理由を入力してください。");
      return;
    }
    const label = { confirm: "金額を確定", invoice: "請求済みに変更", paid: "入金済みに変更", waive: "免除", cancel: "取消" }[action];
    if (!window.confirm(`${label}します。よろしいですか？`)) return;
    setBusy(true);
    const result = await adminUpdateSuccessFeeAction({
      feeId: fee.fee_id,
      action,
      feeAmount,
      taxAmount,
      note: note.trim() ? note.trim() : null,
    });
    setBusy(false);
    setMessage(result.success ? "保存しました。" : result.error);
  }

  const actionLabels: Record<SuccessFeeAction, string> = {
    confirm: fee.fee_status === "confirmed" ? "金額を修正" : "金額を確定",
    invoice: "請求済みにする",
    paid: "入金済みにする",
    waive: "免除",
    cancel: "取消",
  };

  return (
    <article className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-sub">{fee.organization_name ?? "会社"} ／ {fee.store_name}</p>
          <h2 className="mt-1 font-serif text-lg font-bold text-ink">{fee.stylist_name ?? "美容師"}</h2>
          <p className="mt-1 text-[11px] text-sub">採用成立日 {fmtDate(fee.hired_at)}</p>
        </div>
        <span className="shrink-0 rounded-full bg-surface2 px-3 py-1 text-[11px] font-semibold text-sub">{feeStatusLabel(fee.fee_status)}</span>
      </div>

      <BaselineSummary
        baseline={fee.contract_success_fee_amount}
        statusSnapshot={fee.contract_status_snapshot}
        feeAmount={fee.fee_amount}
        taxAmount={fee.tax_amount}
        totalAmount={fee.total_amount}
      />
      <dl className="mt-3 grid grid-cols-5 gap-2 text-[10.5px] text-sub">
        <div><dt>確定日</dt><dd className="text-charcoal">{fmtDate(fee.confirmed_at)}</dd></div>
        <div><dt>請求日</dt><dd className="text-charcoal">{fmtDate(fee.invoiced_at)}</dd></div>
        <div><dt>入金日</dt><dd className="text-charcoal">{fmtDate(fee.paid_at)}</dd></div>
        <div><dt>免除日</dt><dd className="text-charcoal">{fmtDate(fee.waived_at)}</dd></div>
        <div><dt>取消日</dt><dd className="text-charcoal">{fmtDate(fee.cancelled_at)}</dd></div>
      </dl>
      {fee.note && (
        <p className="mt-3 whitespace-pre-wrap rounded-lg bg-surface2 px-3 py-2 text-[11.5px] leading-relaxed text-charcoal">
          運営者メモ：{fee.note}
        </p>
      )}

      {actions.length > 0 ? (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          {canEditAmount && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-sub">成功報酬額（円・整数）
                <input inputMode="numeric" value={feeInput} onChange={(e) => setFeeInput(e.target.value)} disabled={busy}
                  className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-ink" />
              </label>
              <label className="text-[11px] text-sub">税額（円・整数）
                <input inputMode="numeric" value={taxInput} onChange={(e) => setTaxInput(e.target.value)} disabled={busy}
                  className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-ink" />
              </label>
            </div>
          )}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} disabled={busy}
            placeholder="運営者メモ・理由（免除／取消では必須）"
            className="min-h-16 w-full rounded-xl border border-line bg-surface px-3 py-2 text-[12px]" />
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <button key={a} type="button" disabled={busy} onClick={() => run(a)}
                className={`rounded-full px-4 py-2 text-[12px] font-bold disabled:opacity-50 ${
                  a === "waive" || a === "cancel" ? "border border-[#8A2E2E]/30 text-[#8A2E2E]" : "bg-[#285B45] text-white"
                }`}>
                {actionLabels[a]}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-4 border-t border-line pt-3 text-[11.5px] text-sub">この状態は変更できません（閲覧のみ）。</p>
      )}
      {message && <p className="mt-3 text-[12px] text-charcoal">{message}</p>}
    </article>
  );
}
