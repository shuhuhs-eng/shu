/**
 * サロン向け料金表（表示用。金額は各ルール定義から引く＝二重管理しない）。
 * ★文言は法務確認前の草案。公開本文（利用規約）の更新は /admin/legal から行う（本番操作・承認後）。
 */
import { REGISTRATION_PLANS, PURCHASE_UNIT, UNIT_PRICE_EXCL_TAX, PURCHASE_TERMS_NOTE } from "./scout-credit-rules";
import { HIRING_FEE_EXCL_TAX } from "./hiring-fee-rules";
import { EVENT_FEE_EXCL_TAX as VISIT_FEE_EXCL_TAX } from "./event-fee";   // 見学・体験料: 税抜50,000円・税込55,000円（確定 2026-11-28）

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const incl = (excl: number) => excl + Math.floor(excl / 10);

export type PriceRow = { label: string; price: string; note?: string };
export function salonPriceRows(): PriceRow[] {
  const s = REGISTRATION_PLANS.standard, c = REGISTRATION_PLANS.campaign;
  return [
    { label: `${s.label}（登録料）`, price: `税込${yen(s.feeInclTax)}`, note: `初回スカウト${s.initialGrant}件つき。登録料は運営が直接お受けします（オンライン決済ではありません）。` },
    { label: `${c.label}（登録料）`, price: `${yen(c.feeInclTax)}`, note: `初回スカウト${c.initialGrant}件つき。` },
    { label: "月額利用料", price: "無料" },
    { label: `スカウトの追加購入（${PURCHASE_UNIT}件）`, price: `税込${yen(incl(UNIT_PRICE_EXCL_TAX))}`, note: PURCHASE_TERMS_NOTE },
    { label: "見学・体験料", price: `税込${yen(incl(VISIT_FEE_EXCL_TAX))}`, note: `税抜${yen(VISIT_FEE_EXCL_TAX)}。運営から請求書でご請求します。` },
    { label: "採用料（スタイリスト）", price: `税抜${yen(HIRING_FEE_EXCL_TAX.stylist)}`, note: "入社成立時。請求書でのお支払いとなる場合があります。" },
    { label: "採用料（アシスタント）", price: `税抜${yen(HIRING_FEE_EXCL_TAX.assistant)}`, note: "入社成立時。請求書でのお支払いとなる場合があります。" },
  ];
}
