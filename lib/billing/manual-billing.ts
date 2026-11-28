/**
 * 見学・体験料／採用料の手動請求・入金管理（DB 0118 案）の画面側の規則。★オンライン決済・カード請求は行わない。入金は責任者が確認して記録する。
 * 採用料の自動請求（HIRE_BILLING_ENABLED・auto_charge_enabled）は別で、ここからは変更しない。
 */
export type InvoiceKind = "visit_fee" | "hire_fee";
export const KIND_LABELS: Record<InvoiceKind, string> = { visit_fee: "見学・体験料", hire_fee: "採用料" };
export const METHOD_LABELS = { bank_transfer: "銀行振込", cash: "現金", other: "その他" } as const;
export type PayMethod = keyof typeof METHOD_LABELS;
export type InvoiceStatusFilter = "open" | "overdue" | "paid" | "void";
export const FILTER_LABELS: Record<InvoiceStatusFilter, string> = { open: "請求済み・未入金（一部入金を含む）", overdue: "期限超過", paid: "入金済み", void: "取消" };
export function isFilter(v: unknown): v is InvoiceStatusFilter { return v === "open" || v === "overdue" || v === "paid" || v === "void"; }
export type Candidate = { kind: InvoiceKind; source_id: string; organization_id: string; org_name: string; fee_amount: number; tax_amount: number; total_amount: number; sort_date: string; detail: string };
export type InvoiceRow = { id: string; invoice_no: string; kind: InvoiceKind; organization_id: string; organization_name: string; total_amount: number; paid_total: number; outstanding: number; due_on: string; status: "issued" | "paid" | "void"; overdue: boolean; issued_at: string; paid_at: string | null };
export type InvoiceList = { total: number; rows: InvoiceRow[]; open_outstanding: number; overdue_outstanding: number };
export type PaymentRow = { id: string; entry_type: "payment" | "reversal"; amount: number; received_on: string; method: PayMethod; reference: string | null; note: string | null; recorded_at: string; reverses_id: string | null };
export type InvoiceDetail = { invoice: InvoiceRow & { fee_amount: number; tax_amount: number; note: string | null; void_reason: string | null }; payments: PaymentRow[] };
export const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
/** 「請求済み」＝請求書を発行した状態。「入金済み」＝全額の入金を記録した状態。両者は別（請求済みでも入金されるまでは入金済みにならない）。 */
export const STATUS_LEGEND = "請求済み＝請求書を発行した状態／入金済み＝全額の入金を記録した状態（請求済みだけでは入金済みになりません）";
export function statusLabel(r: Pick<InvoiceRow, "status" | "overdue" | "paid_total">): string {
  if (r.status === "paid") return "入金済み"; if (r.status === "void") return "取消";
  if (r.overdue) return r.paid_total > 0 ? "請求済み・期限超過（一部入金）" : "請求済み・期限超過（未入金）"; return r.paid_total > 0 ? "請求済み（一部入金）" : "請求済み（未入金）";
}
/** DBの拒否理由を、操作する人向けの文言にする（内部名は出さない）。超過入金・二重記録などは自動で受け付けず、責任者が個別に確認する。 */
export function manualBillingErrorMessage(m: string | undefined): string {
  const s = m ?? "";
  if (s.includes("exceeds outstanding")) return "請求の残額を超える金額です。受け付けられません。入金の内容を確認してください（過入金は個別に対応します）。";
  if (s.includes("duplicate payment record")) return "同じ金額・日付・参照の入金が既に記録されています（二重記録を防いでいます）。";
  if (s.includes("future")) return "入金日が未来の日付です。";
  if (s.includes("before the invoice was issued")) return "入金日が請求書の発行日より前すぎます。";
  if (s.includes("not open")) return "この請求は入金を受け付けられない状態です（入金済み・取消済み）。";
  if (s.includes("not billable") || s.includes("attempt is open")) return "この請求対象は、いま請求書を発行できない状態です（支払い済み・カード決済の進行中・確認前など）。";
  if (s.includes("agreement is not confirmed")) return "採用の内容がまだ確定していない（または再確認待ち）ため、請求書を発行できません。";
  if (s.includes("due date out of range")) return "支払期限は、今日から120日以内の日付にしてください。";
  if (s.includes("only an unpaid open invoice")) return "入金のある請求は取り消せません。先に入金の記録を取り消してください。";
  if (s.includes("already reversed")) return "この入金は既に取り消されています。";
  if (s.includes("reason required")) return "理由を入力してください。";
  if (s.includes("source changed")) return "元の記録の状態が変わっています。内容を確認してからやり直してください。";
  if (/responsible only|insufficient permission|admin access required/.test(s)) return "この操作は責任者のみ行えます。";
  return "処理を完了できませんでした。時間をおいて、もう一度お試しください。";
}
