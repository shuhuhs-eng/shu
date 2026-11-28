/**
 * スカウト残高の確定済み規則（純粋ロジック。DB・Stripeへは触れない）。
 * 確定（2026-11-28）: 登録は通常（税込33,000円・初回10件）かキャンペーン（0円・初回5件）。本部が登録時に区分を選ぶ／初回付与は法人につき1回のみ（全店舗で共有）／
 *       追加購入は10件単位・税込11,000円（税抜10,000円＋10%）／購入分は購入日から1年間有効で、期限切れの未使用分は失効／購入後は原則返金不可／月額利用料は無料。
 *       初回付与分に期限はない。購入分の消費は期限の早いものから。キャンペーン（購入時の特典）は件数・税抜価格・期間・告知・バナーを運営が設定。
 * 未確定（実装しない）: 登録料（33,000円）の請求・入金の方法、返金時の残高の取消方針（scout_refund_balance_policy）、キャンペーンの併用規則、既存の追加枠との移行（開始残高）。
 */
export type RegistrationPlanCode = "standard" | "campaign";
export const REGISTRATION_PLANS: Record<RegistrationPlanCode, { label: string; feeInclTax: number; initialGrant: number }> = {
  standard: { label: "通常登録", feeInclTax: 33000, initialGrant: 10 },
  campaign: { label: "キャンペーン登録", feeInclTax: 0, initialGrant: 5 },
};
export function isRegistrationPlan(v: unknown): v is RegistrationPlanCode { return v === "standard" || v === "campaign"; }
/** 購入分の有効期間（年）。期限 = 購入日（日本時間の暦日）の1年後の0時。例: 2026-11-28 購入 → 最後に使える日は 2027-11-27。 */
export const PURCHASE_VALID_YEARS = 1 as const;
const jstDate = (d: Date) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
/** 購入日時から「最後に使える日」（日本時間の暦日 YYYY-MM-DD）。DBの _scout_expiry_for と同じ規則（うるう日は翌年の2月28日）。 */
export function lastValidDay(purchasedAt: Date): string {
  const [y, m, d] = jstDate(purchasedAt).split("-").map(Number);
  const target = new Date(Date.UTC(y + PURCHASE_VALID_YEARS, m - 1, d));
  if (target.getUTCMonth() !== m - 1) target.setUTCDate(0);   // 2/29 → 翌年は 2/28
  target.setUTCDate(target.getUTCDate() - 1);
  return target.toISOString().slice(0, 10);
}
export const PURCHASE_TERMS_NOTE = "10件につき税込11,000円。購入分は購入日から1年間有効で、期限を過ぎた未使用分は失効します。購入後の返金は原則できません。";
export const PURCHASE_UNIT = 10 as const;
export const UNIT_PRICE_EXCL_TAX = 10000 as const;

export function canGrantInitial(alreadyGranted: boolean): boolean { return !alreadyGranted; }
export function isValidPurchaseQuantity(q: number): boolean { return Number.isInteger(q) && q > 0 && q % PURCHASE_UNIT === 0 && q <= 10000; }
export function purchasePrice(quantity: number): { fee: number; tax: number; total: number } {
  if (!isValidPurchaseQuantity(quantity)) throw new Error("invalid quantity");
  const fee = (quantity / PURCHASE_UNIT) * UNIT_PRICE_EXCL_TAX; const tax = Math.floor((fee * 10) / 100); return { fee, tax, total: fee + tax };
}
export type Campaign = { quantity: number; priceExclTax: number; startsOn: string; endsOn: string };
/** キャンペーンが有効か（日本時間の暦日で、開始日・終了日を含む）。設定内容は運営が決める。 */
export function campaignActive(c: Campaign, todayJst: string): boolean { return c.startsOn <= todayJst && todayJst <= c.endsOn; }
export function campaignValid(c: Campaign): boolean {
  return Number.isInteger(c.quantity) && c.quantity > 0 && Number.isInteger(c.priceExclTax) && c.priceExclTax >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(c.startsOn) && /^\d{4}-\d{2}-\d{2}$/.test(c.endsOn) && c.startsOn <= c.endsOn;
}
