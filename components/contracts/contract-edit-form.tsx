"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateOrganizationContractAction } from "@/lib/contracts/actions";
import { CONTRACT_STATUS_LABELS } from "@/lib/contracts/format";
import { CONTRACT_STATUSES } from "@/lib/contracts/types";
import type { AdminContractDetail } from "@/lib/contracts/types";

const INPUT = "mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-ink";

/** 契約条件の編集フォーム（運営者のみ。権限の本体はRPC）。成功報酬方式は固定額のみ。 */
export function ContractEditForm({ detail }: { detail: AdminContractDetail }) {
  const router = useRouter();
  const c = detail.contract;
  const [status, setStatus] = useState<string>(c?.contract_status ?? "");
  const [amount, setAmount] = useState(c?.success_fee_amount == null ? "" : String(c.success_fee_amount));
  const [monthly, setMonthly] = useState(c?.monthly_fee == null ? "" : String(c.monthly_fee));
  const [started, setStarted] = useState(c?.contract_started_at ?? "");
  const [ended, setEnded] = useState(c?.contract_ended_at ?? "");
  const [fiscal, setFiscal] = useState(detail.fiscal_year_start_month);
  const [note, setNote] = useState(c?.note ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const needsReason = status === "suspended" || status === "cancelled";

  async function save() {
    setMessage(null);
    if (needsReason && !reason.trim()) {
      setMessage({ ok: false, text: "一時停止・解約にするときは、変更理由を入力してください。" });
      return;
    }
    if (!window.confirm("契約条件を保存します。変更内容は履歴に残ります。よろしいですか？")) return;
    setBusy(true);
    const result = await updateOrganizationContractAction({
      organizationId: detail.organization_id,
      contractStatus: status === "" ? "" : (CONTRACT_STATUSES.find((s) => s === status) ?? ""),
      successFeeAmount: amount,
      monthlyFee: monthly,
      startedAt: started,
      endedAt: ended,
      fiscalYearStartMonth: fiscal,
      note,
      reason,
    });
    setBusy(false);
    if (result.success) {
      setMessage({ ok: true, text: result.changed ? "保存しました。" : "変更はありません。" });
      if (result.changed) {
        setReason("");
        router.refresh();
      }
    } else {
      setMessage({ ok: false, text: result.error });
    }
  }

  return (
    <form
      className="space-y-4 rounded-2xl border border-line bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="block text-[11px] text-sub">契約状態
        <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={busy} className={INPUT}>
          {c === null && <option value="">契約条件未設定</option>}
          {CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{CONTRACT_STATUS_LABELS[s]}</option>)}
        </select>
      </label>

      <p className="text-[12px] text-charcoal">成功報酬方式：固定額（採用1名につき）</p>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-[11px] text-sub">成功報酬額（円・整数、空欄=未設定）
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} className={INPUT} />
        </label>
        <label className="block text-[11px] text-sub">月額（円・整数、空欄=未設定）
          <input inputMode="numeric" value={monthly} onChange={(e) => setMonthly(e.target.value)} disabled={busy} className={INPUT} />
        </label>
        <label className="block text-[11px] text-sub">契約開始日
          <input type="date" value={started} onChange={(e) => setStarted(e.target.value)} disabled={busy} className={INPUT} />
        </label>
        <label className="block text-[11px] text-sub">契約終了日
          <input type="date" value={ended} onChange={(e) => setEnded(e.target.value)} disabled={busy} className={INPUT} />
        </label>
      </div>
      <p className="text-[11px] leading-relaxed text-sub">
        成功報酬額は「契約上の基準額」です。採用が成立した時点の金額が記録されますが、請求額は自動では確定されません。月額は記録のみで、自動課金は行いません。
      </p>

      <label className="block text-[11px] text-sub">年度開始月
        <select value={fiscal} onChange={(e) => setFiscal(Number(e.target.value))} disabled={busy} className={INPUT}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}月</option>)}
        </select>
      </label>

      <label className="block text-[11px] text-sub">運営者用メモ（会社には表示されません）
        <textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} rows={3} maxLength={1000} className={INPUT} />
      </label>

      <label className="block text-[11px] text-sub">変更理由{needsReason ? "（必須）" : "（金額・状態・年度開始月の変更では入力をおすすめします）"}
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} rows={2} maxLength={1000} className={INPUT} />
      </label>

      {message && (
        <p className={`rounded-lg px-3 py-2 text-[12px] ${message.ok ? "bg-[#EAF3EC] text-[#2E6B4F]" : "bg-[#C24545]/10 text-[#8A2E2E]"}`}>{message.text}</p>
      )}
      <button type="submit" disabled={busy} className="rounded-full bg-ink px-6 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
        {busy ? "保存中…" : "保存する"}
      </button>
    </form>
  );
}
