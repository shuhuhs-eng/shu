/**
 * 月額請求書の発行状態の判定（純粋関数）。
 * 発行の失敗理由はDBに残さない（0049に失敗記録は無い）ため、
 * 「未発行・不足項目なし・一定時間経過」を“発行失敗の可能性”として扱い、再試行を促す。
 */
export const PREPARING_WINDOW_MS = 30 * 60 * 1000;

export type CompanyInvoiceState = "available" | "preparing" | "pending";
/** 会社向け：内部事情は出さない。直後は「準備中」、それ以降は「現在準備しています」。 */
export function companyInvoiceState(hasDocument: boolean, paidAtIso: string, now: Date): CompanyInvoiceState {
  if (hasDocument) return "available";
  const paid = Date.parse(paidAtIso);
  return Number.isNaN(paid) || now.getTime() - paid <= PREPARING_WINDOW_MS ? "preparing" : "pending";
}

export const COMPANY_INVOICE_TEXT: Record<Exclude<CompanyInvoiceState, "available">, string> = {
  preparing: "請求書を準備中です",
  pending: "請求書を現在準備しています",
};

export type AdminInvoiceState = "issued" | "missing" | "processing" | "failed";
/** 運営向け：発行済み／発行条件不足／発行処理中／発行失敗の可能性。 */
export function adminInvoiceState(hasDocument: boolean, missing: string[], paidAtIso: string, now: Date): AdminInvoiceState {
  if (hasDocument) return "issued";
  if (missing.length > 0) return "missing";
  const paid = Date.parse(paidAtIso);
  return Number.isNaN(paid) || now.getTime() - paid <= PREPARING_WINDOW_MS ? "processing" : "failed";
}

export const ADMIN_INVOICE_STATE_LABELS: Record<AdminInvoiceState, string> = {
  issued: "PDF発行済み",
  missing: "発行条件不足",
  processing: "発行処理中",
  failed: "発行失敗（再試行してください）",
};
