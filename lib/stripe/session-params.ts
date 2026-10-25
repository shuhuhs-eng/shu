// Stripeへ渡すCheckout Sessionのline item組み立て（純粋関数。server-onlyではないのでテスト可能）。
//
// 【税ルール】Stripeへ渡す金額は、必ずBeauty Reach DBが確定した税込 total_amount。
//  - 税の計算・加算はDB側で行い、ここでは再計算しない（browser/clientの値も使わない）。
//  - Stripe Tax / tax_rates / automatic_tax は使わない。使うとStripe側で更に10%が加算され二重課税になる。
//    そのため automatic_tax を明示的に無効化し、line itemにtax_behaviorは持たせない（金額は税込の最終額）。
//  - 商品名に「税込」を明記し、請求画面・領収書で税込額であることが分かるようにする。
import type Stripe from "stripe";

export type MonthlyBeginData = {
  record_id: string; monthly_fee_excl_tax: number; tax_amount: number; total_amount: number;
};
export type SuccessFeeBeginData = {
  record_id: string; success_fee_id: string; organization_id: string; invoice_number: string | null; total_amount: number;
};
export type ScoutBeginData = { record_id: string; label: string; credits: number; total_amount: number };

const NO_STRIPE_TAX = { enabled: false } as const;

export function buildMonthlySessionParams(data: MonthlyBeginData): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "subscription",
    automatic_tax: NO_STRIPE_TAX,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "jpy",
        unit_amount: data.total_amount, // 税込（月額税抜 + DB計算の消費税）
        recurring: { interval: "month" },
        product_data: { name: "Beauty Reach 月額利用料金（税込）" },
      },
    }],
    metadata: { checkout_record_id: data.record_id, purpose: "monthly_subscription" },
    subscription_data: { metadata: { beauty_reach_purpose: "monthly_subscription", checkout_record_id: data.record_id } },
  };
}

export function buildSuccessFeeSessionParams(data: SuccessFeeBeginData): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "payment",
    automatic_tax: NO_STRIPE_TAX,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "jpy",
        unit_amount: data.total_amount, // hiring_success_fees.total_amount（0045確定の税込額）
        product_data: { name: `採用成功報酬（税込・請求書番号 ${data.invoice_number ?? "-"}）` },
      },
    }],
    metadata: {
      checkout_record_id: data.record_id, purpose: "success_fee",
      success_fee_id: data.success_fee_id, organization_id: data.organization_id,
    },
    payment_intent_data: { metadata: { checkout_record_id: data.record_id, success_fee_id: data.success_fee_id } },
  };
}

export function buildScoutCreditSessionParams(data: ScoutBeginData): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "payment",
    automatic_tax: NO_STRIPE_TAX,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "jpy",
        unit_amount: data.total_amount, // 税込（price_excl_tax + DB計算の消費税）
        product_data: { name: `追加スカウト枠 ${data.credits}件（${data.label}・税込）` },
      },
    }],
    metadata: { checkout_record_id: data.record_id, purpose: "scout_credits" },
    payment_intent_data: { metadata: { checkout_record_id: data.record_id } },
  };
}
