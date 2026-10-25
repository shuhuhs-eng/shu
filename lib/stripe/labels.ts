/** 画面表示用の文言（純粋関数・定数。Stripeの内部用語は出さない）。 */
export type SubscriptionPaymentState = "pending" | "active" | "past_due" | "payment_failed" | "cancelled";

export const SUBSCRIPTION_STATE_LABELS: Record<SubscriptionPaymentState, string> = {
  pending: "お支払い確認中",
  active: "正常",
  past_due: "お支払いが遅れています（自動で再試行中）",
  payment_failed: "お支払いに失敗しました",
  cancelled: "月額課金は解約済みです",
};

export const SUBSCRIPTION_STATE_CLASSES: Record<SubscriptionPaymentState, string> = {
  pending: "bg-surface2 text-sub",
  active: "bg-[#285B45]/10 text-[#285B45]",
  past_due: "bg-[#B7791F]/10 text-[#8A5A12]",
  payment_failed: "bg-[#C24545]/10 text-[#8A2E2E]",
  cancelled: "bg-surface2 text-sub",
};

export function subscriptionStateLabel(s: string | null | undefined): string {
  if (!s) return "未設定";
  return SUBSCRIPTION_STATE_LABELS[s as SubscriptionPaymentState] ?? "確認中";
}

const BRANDS: Record<string, string> = {
  visa: "Visa", mastercard: "Mastercard", amex: "American Express", jcb: "JCB", diners: "Diners Club", discover: "Discover", unionpay: "UnionPay",
};
export function cardBrandLabel(brand: string): string {
  return BRANDS[brand] ?? brand.toUpperCase();
}
export function formatCardExpiry(month: number, year: number): string {
  return `${String(month).padStart(2, "0")}/${String(year % 100).padStart(2, "0")}`;
}

export const PAYMENT_METHOD_LABELS = { card: "カード", bank_transfer: "銀行振込" } as const;

export const RETURN_MESSAGES: Record<string, { success: string; cancel: string }> = {
  card: { success: "カードの登録手続きから戻りました。登録の反映には数十秒かかることがあります。反映されない場合は、画面を更新してください。", cancel: "カードの登録を中止しました。" },
  subscription: { success: "月額課金のお手続きから戻りました。反映には数十秒かかることがあります。", cancel: "月額課金のお手続きを中止しました。" },
  success_fee: { success: "お支払い手続きから戻りました。入金の確認が取れるまで数十秒かかることがあります。「入金済み」と表示されるまでお待ちください（この画面に戻っただけでは入金済みにはなりません）。", cancel: "お支払いを中止しました。請求は未払いのままです。" },
  scout_credits: { success: "追加枠のお手続きから戻りました。決済の確認が取れ次第、枠が追加されます。", cancel: "追加枠の購入を中止しました。" },
  portal: { success: "お支払い設定の画面から戻りました。", cancel: "お支払い設定の画面から戻りました。" },
};
