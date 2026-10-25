/**
 * 税額の「表示用プレビュー」専用（admin商品フォームの入力補助）。
 * 実際の課金額・税額は必ずDB（billing_tax_amount）が確定する。DBと同じ規則（1円未満切り捨て）。
 * この関数の結果をDB・Stripeへ送ることはない。
 */
export function previewTax(exclTax: number, ratePercent: number): { tax: number; total: number } {
  if (!Number.isFinite(exclTax) || !Number.isFinite(ratePercent)) return { tax: 0, total: 0 };
  // DB: floor(fee * rate / 100)。numeric(5,2)の税率を整数化して浮動小数点誤差を避ける。
  const tax = Math.floor((exclTax * Math.round(ratePercent * 100)) / 10000);
  return { tax, total: exclTax + tax };
}
