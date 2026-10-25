/** DB RPC / Stripe 設定エラーを、会社担当者に見せてよい日本語の文言へ変換する（内部情報は出さない）。 */
export function mapStripeActionError(message: string | undefined | null): string {
  const m = message ?? "";
  if (m.includes("stripe not configured")) return "カード決済は現在準備中です。しばらくしてからお試しください。";
  if (m.includes("contract not active")) return "契約が有効な状態ではないため、この操作はできません。";
  if (m.includes("monthly fee not set")) return "月額利用料金が設定されていません。運営にお問い合わせください。";
  if (m.includes("monthly fee is zero")) return "月額利用料金は0円のため、カード課金の設定は不要です。";
  if (m.includes("subscription already exists")) return "月額課金はすでに設定されています。画面を更新してください。";
  if (m.includes("success fee is not payable")) return "この請求はカードで支払える状態ではありません（入金済み、または請求前です）。画面を更新してください。";
  if (m.includes("nothing to pay")) return "お支払い金額がありません。";
  if (m.includes("scout credit package not available")) return "この追加枠は現在購入できません。";
  if (m.includes("organization not found") || m.includes("caller is not a salon") || m.includes("not authenticated")) {
    return "この操作を行う権限がありません。";
  }
  if (m.includes("mode mismatch")) return "決済環境の設定が一致しません。運営にお問い合わせください。";
  if (m.includes("checkout already completed")) return "お支払い手続きはすでに完了しているか、反映待ちです。しばらくしてから画面を更新してください。";
  return "処理を開始できませんでした。時間をおいて再度お試しください。";
}

/** クライアントへ返してよいStripe遷移先か（ホスティング画面のhttpsのみ）。 */
export function isAllowedStripeRedirect(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "checkout.stripe.com" || u.hostname === "billing.stripe.com");
  } catch {
    return false;
  }
}
