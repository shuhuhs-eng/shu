import type { SuccessFeeAction, SuccessFeeStatus } from "./types";

/** 画面に出す日本語。内部名（pending_confirmation等）はそのまま表示しない。 */
export const FEE_STATUS_LABELS: Record<SuccessFeeStatus, string> = {
  pending_confirmation: "請求確認中",
  confirmed: "請求額確定",
  invoiced: "請求済み",
  paid: "入金済み",
  waived: "免除",
  cancelled: "取消",
};

export function feeStatusLabel(status: string): string {
  return (FEE_STATUS_LABELS as Record<string, string>)[status] ?? "確認中";
}

/** 運営者が現在の状態から実行できる操作（DBの遷移規則と同じ）。 */
export function availableFeeActions(status: string): SuccessFeeAction[] {
  switch (status) {
    case "pending_confirmation":
      return ["confirm", "waive", "cancel"];
    case "confirmed":
      return ["confirm", "invoice", "waive", "cancel"];
    case "invoiced":
      return ["paid", "cancel"];
    default:
      return [];
  }
}

export function isFeeAction(value: string): value is SuccessFeeAction {
  return value === "confirm" || value === "invoice" || value === "paid" || value === "waive" || value === "cancel";
}

/** 金額表示。null（未確定）を0円と表示しない。 */
export function formatYen(amount: number | null): string {
  return amount === null ? "未確定" : `${amount.toLocaleString("ja-JP")}円`;
}

/** 整数円の入力を検証して数値にする。不正なら null。 */
export function parseYenInput(raw: string): number | null {
  const normalized = raw.trim().replace(/[,，]/g, "");
  if (!/^\d{1,9}$/.test(normalized)) return null;
  return Number(normalized);
}

export function sumAmounts(rows: Array<{ total_amount: number | null }>): number {
  return rows.reduce((sum, r) => sum + (r.total_amount ?? 0), 0);
}
