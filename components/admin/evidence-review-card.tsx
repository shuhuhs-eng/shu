"use client";

import { useState } from "react";
import { reviewEvidence } from "@/lib/admin/evidence-actions";

type Item = {
  id: string; public_name: string | null; document_type: string; original_file_name: string;
  review_status: string; review_reason: string | null; review_note: string | null;
  signed_url: string | null; is_pdf: boolean;
  declared_metrics: {
    evidence_period_months: number | null; avg_monthly_technical_sales: number | null;
    avg_monthly_clients: number | null; avg_monthly_named_clients: number | null;
    average_ticket: number | null; expected_transfer_clients: number | null;
  };
};

const TYPE_LABELS: Record<string, string> = { pos_sales: "POS・売上画面", payslip: "給与・歩合明細", performance_report: "実績表", other: "その他" };
const REJECTION_REASONS = [
  ["unrelated", "関係のない資料"], ["unreadable", "不鮮明・読み取れない"],
  ["insufficient", "情報不足"], ["numbers_mismatch", "申告数字と不一致"],
  ["suspected_tampering", "加工・改ざんの疑い"],
] as const;

export function EvidenceReviewCard({ item }: { item: Item }) {
  const [reason, setReason] = useState("unrelated");
  const [note, setNote] = useState(item.review_note ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function decide(decision: "verified" | "rejected") {
    setBusy(true); setMessage(null);
    const result = await reviewEvidence({ documentId: item.id, decision, reason: decision === "verified" ? "valid" : reason as typeof REJECTION_REASONS[number][0], note: note || null });
    setBusy(false);
    setMessage(result.success ? (decision === "verified" ? "資料一致として承認しました。" : "差し戻しました。") : result.error);
  }

  const m = item.declared_metrics;
  return <article className="rounded-2xl border border-line bg-surface p-5">
    <div className="flex items-start justify-between gap-3">
      <div><p className="eyebrow mb-1">{TYPE_LABELS[item.document_type] ?? item.document_type}</p><h2 className="font-serif text-lg font-bold text-ink">{item.public_name ?? "美容師"}</h2><p className="mt-1 text-[11px] text-sub">{item.original_file_name}</p></div>
      <span className="rounded-full bg-surface2 px-3 py-1 text-[11px] font-semibold text-sub">{{ submitted: "未確認", verified: "資料一致", rejected: "差し戻し" }[item.review_status] ?? item.review_status}</span>
    </div>
    <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
      <p className="rounded-lg bg-surface2 p-2">技術売上<br /><strong className="text-[13px]">{m.avg_monthly_technical_sales?.toLocaleString() ?? "—"}円</strong></p>
      <p className="rounded-lg bg-surface2 p-2">客数<br /><strong className="text-[13px]">{m.avg_monthly_clients ?? "—"}名</strong></p>
      <p className="rounded-lg bg-surface2 p-2">指名客数<br /><strong className="text-[13px]">{m.avg_monthly_named_clients ?? "—"}名</strong></p>
      <p className="rounded-lg bg-surface2 p-2">客単価<br /><strong className="text-[13px]">{m.average_ticket?.toLocaleString() ?? "—"}円</strong></p>
    </div>
    <div className="relative mt-4 overflow-hidden rounded-xl border border-line bg-surface2">
      {item.signed_url ? (item.is_pdf ? <iframe title="提出PDF" src={item.signed_url} className="h-[480px] w-full" /> : <img src={item.signed_url} alt="提出された証明資料" className="max-h-[600px] w-full object-contain" />) : <p className="p-8 text-center text-[12px] text-sub">資料を表示できません</p>}
      <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[10px] font-bold text-black/25">BEAUTY REACH 確認用</div>
    </div>
    <p className="mt-3 text-[10.5px] leading-relaxed text-sub">「資料一致」は、資料内の内容と申告値の一致確認です。発行元による真正性の保証ではありません。</p>
    <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="確認メモ（任意）" className="mt-4 min-h-20 w-full rounded-xl border border-line bg-surface px-3 py-2 text-[12px]" />
    <div className="mt-3 flex gap-2">
      <button type="button" disabled={busy} onClick={() => decide("verified")} className="rounded-full bg-[#285B45] px-4 py-2 text-[12px] font-bold text-white disabled:opacity-50">資料一致として承認</button>
      <select value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} className="min-w-0 flex-1 rounded-full border border-line bg-surface px-3 text-[11px]">{REJECTION_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <button type="button" disabled={busy} onClick={() => decide("rejected")} className="rounded-full border border-[#8A2E2E]/30 px-4 py-2 text-[12px] font-bold text-[#8A2E2E] disabled:opacity-50">差し戻す</button>
    </div>
    {message && <p className="mt-3 text-[12px] text-charcoal">{message}</p>}
  </article>;
}

