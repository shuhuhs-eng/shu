import { formatDueDate, formatTaxRate, formatYen, isLegacyInvoice } from "@/lib/billing/format";

type Props = {
  feeStatus: string;
  invoiceNumber: string | null;
  invoicedAt: string | null;
  dueDate: string | null;
  taxRate: number | null;
  feeAmount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });
}

/**
 * 請求書の内容（読み取り専用）。請求書番号・請求日・支払期限・税率・金額を並べる。
 * ★0045より前に請求された旧データは、番号・期限・税率が無くてもエラーにせず
 *   「旧請求データ（請求書番号は未記録）」と表示する。推測で補わない。
 * ★請求前（確認中・金額確定）は請求書がまだ無いので、何も表示しない。
 */
export function InvoiceSummary({ feeStatus, invoiceNumber, invoicedAt, dueDate, taxRate, feeAmount, taxAmount, totalAmount }: Props) {
  if (isLegacyInvoice(feeStatus, invoiceNumber)) {
    return (
      <p className="mt-3 rounded-lg bg-surface2 px-3 py-2 text-[11.5px] leading-relaxed text-sub">
        旧請求データ（請求書番号は未記録です）。請求日 {fmtDate(invoicedAt)}
      </p>
    );
  }
  if (invoiceNumber === null) return null;
  return (
    <section className="mt-3 rounded-xl border border-line bg-surface2 p-3">
      <p className="text-[11px] font-bold text-ink">請求書</p>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        <div><dt className="text-sub">請求書番号</dt><dd className="mt-0.5 text-[13px] font-bold text-ink">{invoiceNumber}</dd></div>
        <div><dt className="text-sub">請求日</dt><dd className="mt-0.5 text-[13px] font-bold text-ink">{fmtDate(invoicedAt)}</dd></div>
        <div><dt className="text-sub">支払期限</dt><dd className="mt-0.5 text-[13px] font-bold text-ink">{formatDueDate(dueDate)}</dd></div>
        <div><dt className="text-sub">適用税率</dt><dd className="mt-0.5 text-[13px] font-bold text-ink">{formatTaxRate(taxRate)}</dd></div>
        <div><dt className="text-sub">請求額（税抜）</dt><dd className="mt-0.5 text-[13px] font-bold text-ink">{formatYen(feeAmount)}</dd></div>
        <div><dt className="text-sub">消費税額</dt><dd className="mt-0.5 text-[13px] font-bold text-ink">{formatYen(taxAmount)}</dd></div>
        <div><dt className="text-sub">合計（税込）</dt><dd className="mt-0.5 text-[13px] font-bold text-ink">{formatYen(totalAmount)}</dd></div>
      </dl>
    </section>
  );
}
