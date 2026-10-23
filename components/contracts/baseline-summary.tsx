import { baselineDifference, contractStatusLabel, formatSignedYen } from "@/lib/contracts/format";
import { formatYen } from "@/lib/billing/format";

type Props = {
  baseline: number | null;
  /** 採用成立時の契約状態（snapshot）。無ければ null。 */
  statusSnapshot: string | null;
  feeAmount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
};

/**
 * 契約基準額（採用成立時のsnapshot）と実際の請求額を並べて見せる。
 * ★基準額が記録されていない(0043より前など)場合は0円ではなく「未記録」。
 * ★差額は「基準額との差額」とだけ表示し、値引き・追加料金などの意味は付けない。
 */
export function BaselineSummary({ baseline, statusSnapshot, feeAmount, taxAmount, totalAmount }: Props) {
  const diff = baselineDifference(baseline, feeAmount);
  return (
    <>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        <div className="rounded-lg bg-surface2 p-2">
          <dt>契約基準額</dt>
          <dd className="mt-0.5 text-[13px] font-bold">{baseline === null ? "未記録" : formatYen(baseline)}</dd>
          {baseline !== null && statusSnapshot && <dd className="text-[10px] text-sub">採用時の契約状態：{contractStatusLabel(statusSnapshot)}</dd>}
        </div>
        <div className="rounded-lg bg-surface2 p-2"><dt>実際の請求額</dt><dd className="mt-0.5 text-[13px] font-bold">{formatYen(feeAmount)}</dd></div>
        <div className="rounded-lg bg-surface2 p-2"><dt>税額</dt><dd className="mt-0.5 text-[13px] font-bold">{formatYen(taxAmount)}</dd></div>
        <div className="rounded-lg bg-surface2 p-2"><dt>合計</dt><dd className="mt-0.5 text-[13px] font-bold">{formatYen(totalAmount)}</dd></div>
      </dl>
      {diff !== null && <p className="mt-1.5 text-[11px] text-charcoal">基準額との差額：{formatSignedYen(diff)}</p>}
    </>
  );
}
