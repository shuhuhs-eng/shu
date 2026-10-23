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

/** 請求書の表示用：日本時間の暦日を「2026年11月30日」形式にする（due_dateはDBのdate文字列 YYYY-MM-DD）。 */
export function formatDueDate(date: string | null): string {
  if (!date) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return "—";
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

/** 日本時間で「今日」を YYYY-MM-DD にする。 */
export function jstToday(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/**
 * 標準の支払期限＝請求日（日本時間）の翌月末。表示専用の目安で、確定値はDBが決める
 * （DBの billing_standard_due_date と同じ規則）。
 */
export function standardDueDate(invoiceDate: string): string {
  const [y, m] = invoiceDate.split("-").map(Number);
  // 翌々月1日の前日 = 翌月末（UTCで計算し、時差の影響を受けない）。
  const d = new Date(Date.UTC(y, m + 1, 0));
  return d.toISOString().slice(0, 10);
}

/** 税率(%)の表示。小数点以下の無駄な0は出さない（10.00 → 10%）。 */
export function formatTaxRate(rate: number | null): string {
  return rate === null ? "—" : `${Number(rate)}%`;
}

/** 0045より前に請求された旧データか（請求済み以降で請求書番号が無い）。nullはエラー扱いしない。 */
export function isLegacyInvoice(status: string, invoiceNumber: string | null): boolean {
  return invoiceNumber === null && (status === "invoiced" || status === "paid");
}
