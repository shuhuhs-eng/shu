import type { SuccessFeeStatus } from "./types";

type FeeLike = { fee_status: string; total_amount: number | null };

export type FeeSummary = {
  hiredCount: number;
  counts: Record<SuccessFeeStatus, number>;
  /** 成功報酬総額: 金額が確定した分（請求額確定・請求済み・入金済み）の合計。免除・取消は含めない。 */
  confirmedTotal: number;
  /** 請求済み総額: 請求を出した分（請求済み・入金済み）の合計。 */
  invoicedTotal: number;
  /** 入金済み総額。 */
  paidTotal: number;
};

export function summarizeFees(rows: FeeLike[]): FeeSummary {
  const counts: Record<SuccessFeeStatus, number> = {
    pending_confirmation: 0,
    confirmed: 0,
    invoiced: 0,
    paid: 0,
    waived: 0,
    cancelled: 0,
  };
  let confirmedTotal = 0;
  let invoicedTotal = 0;
  let paidTotal = 0;
  for (const r of rows) {
    if (r.fee_status in counts) counts[r.fee_status as SuccessFeeStatus] += 1;
    const amount = r.total_amount ?? 0;
    if (r.fee_status === "confirmed" || r.fee_status === "invoiced" || r.fee_status === "paid") confirmedTotal += amount;
    if (r.fee_status === "invoiced" || r.fee_status === "paid") invoicedTotal += amount;
    if (r.fee_status === "paid") paidTotal += amount;
  }
  return { hiredCount: rows.length, counts, confirmedTotal, invoicedTotal, paidTotal };
}
