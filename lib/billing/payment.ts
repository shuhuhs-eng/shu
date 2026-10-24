import { jstToday } from "./format";

/**
 * 入金状況の表示用の区分。★DBには保存しない（新しいstatusは作らない）。
 *   請求済み(invoiced) かつ 支払期限 < 今日（日本時間）→ 期限超過。
 * 旧請求データ（支払期限が無い請求済み）は、期限超過かどうか判断できないため「未入金」とする。
 */
export type PaymentState = "pre_invoice" | "unpaid" | "overdue" | "paid" | "closed";

type FeeLike = { fee_status: string; due_date: string | null };

export function paymentState(fee: FeeLike, today: string = jstToday()): PaymentState {
  switch (fee.fee_status) {
    case "pending_confirmation":
    case "confirmed":
      return "pre_invoice";
    case "invoiced":
      return fee.due_date !== null && fee.due_date < today ? "overdue" : "unpaid";
    case "paid":
      return "paid";
    default:
      return "closed"; // 免除・取消
  }
}

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  pre_invoice: "請求前",
  unpaid: "未入金",
  overdue: "支払期限超過",
  paid: "入金済み",
  closed: "免除・取消",
};

/** 状態バッジの色（期限超過だけ警告色）。 */
export const PAYMENT_STATE_CLASSES: Record<PaymentState, string> = {
  pre_invoice: "bg-surface2 text-sub",
  unpaid: "bg-[#B8860B]/15 text-[#7A5A06]",
  overdue: "bg-[#C24545]/15 text-[#8A2E2E]",
  paid: "bg-[#285B45]/10 text-[#285B45]",
  closed: "bg-surface2 text-sub",
};

/** 期限超過の日数（今日 − 支払期限）。超過していなければ 0。 */
export function overdueDays(dueDate: string | null, today: string = jstToday()): number {
  if (!dueDate || dueDate >= today) return 0;
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

export function countPaymentStates(rows: FeeLike[], today: string = jstToday()): Record<PaymentState, number> {
  const counts: Record<PaymentState, number> = { pre_invoice: 0, unpaid: 0, overdue: 0, paid: 0, closed: 0 };
  for (const r of rows) counts[paymentState(r, today)] += 1;
  return counts;
}
