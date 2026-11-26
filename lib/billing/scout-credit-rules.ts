/**
 * スカウト残高の確定済み規則（純粋ロジック。DB・Stripeへは触れない）。
 * 確定: 初回スカウトは法人ごとに10件を1回だけ付与（全店舗で共有）／通常購入は10件単位・10,000円（税抜）／
 *       無料分・購入分とも現在は期限なし／キャンペーンは件数・税抜価格・期間・告知・バナーを運営が設定。
 * 未確定（実装しない）: 消費の順序（無料分と購入分のどちらを先に使うか）、返金・取消時の残高の扱い、キャンペーンの併用規則、既存の追加枠との移行（開始残高）。
 */
export const INITIAL_GRANT = 10 as const;
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
