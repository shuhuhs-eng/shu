/**
 * Stripe環境設定の純粋関数（テスト可能にするため server-only にしない。
 * 秘密鍵そのものはここでは扱わず、鍵の「種類」と必要な環境変数の有無だけを判定する）。
 *
 * 方針:
 *   ・最初は Test Mode のみ。sk_live_ / rk_live_ は STRIPE_ALLOW_LIVE_MODE=true が無い限り拒否する
 *     （本番公開の最終手順で意図的に有効化するまで、うっかり実カードを請求しない安全弁）。
 *   ・STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET はサーバー専用。NEXT_PUBLIC_ には置かない。
 *   ・Checkout / Customer Portal はStripeのホスティング画面へリダイレクトする方式のため、
 *     ブラウザ側にStripe.jsやpublishable keyは不要（NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEYは使わない）。
 */
export type StripeMode = "test" | "live";

export function stripeKeyMode(key: string | undefined | null): StripeMode | null {
  if (!key) return null;
  if (/^(sk|rk)_test_/.test(key)) return "test";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  return null;
}

type Env = Record<string, string | undefined>;

export type StripeEnvCheck =
  | { ok: true; mode: StripeMode; livemode: boolean }
  | { ok: false; reason: "missing_key" | "invalid_key" | "live_not_allowed" | "missing_webhook_secret" | "missing_site_url" };

/** Checkout/決済開始に必要な設定（webhook secretはwebhook側で別途確認）。 */
export function checkStripeEnv(env: Env): StripeEnvCheck {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) return { ok: false, reason: "missing_key" };
  const mode = stripeKeyMode(key);
  if (!mode) return { ok: false, reason: "invalid_key" };
  if (mode === "live" && env.STRIPE_ALLOW_LIVE_MODE !== "true") return { ok: false, reason: "live_not_allowed" };
  if (!env.NEXT_PUBLIC_SITE_URL?.trim()) return { ok: false, reason: "missing_site_url" };
  return { ok: true, mode, livemode: mode === "live" };
}

export function checkStripeWebhookEnv(env: Env): { ok: true; livemode: boolean } | { ok: false; reason: string } {
  const base = checkStripeEnv({ ...env, NEXT_PUBLIC_SITE_URL: env.NEXT_PUBLIC_SITE_URL ?? "unused" });
  if (!base.ok) return { ok: false, reason: base.reason };
  if (!env.STRIPE_WEBHOOK_SECRET?.trim()) return { ok: false, reason: "missing_webhook_secret" };
  return { ok: true, livemode: base.livemode };
}

/** Checkoutのsuccess/cancel/returnに使う自サイトの戻り先（外部URLへは絶対に飛ばさない）。 */
export function buildReturnUrl(siteUrl: string, query: Record<string, string>): string {
  const base = siteUrl.replace(/\/+$/, "");
  const qs = new URLSearchParams(query).toString();
  return `${base}/salon/company/billing${qs ? `?${qs}` : ""}`;
}

/** 戻り先クエリ(stripe=...)の表示用ステータス。戻っただけでは何も確定しない旨を画面に出す。 */
export const RETURN_KINDS = ["card", "subscription", "success_fee", "scout_credits", "portal"] as const;
export type ReturnKind = (typeof RETURN_KINDS)[number];
export function parseReturn(params: { stripe?: string | string[]; kind?: string | string[] }): { status: "success" | "cancel"; kind: ReturnKind } | null {
  const s = Array.isArray(params.stripe) ? params.stripe[0] : params.stripe;
  const k = Array.isArray(params.kind) ? params.kind[0] : params.kind;
  if ((s !== "success" && s !== "cancel") || !k || !(RETURN_KINDS as readonly string[]).includes(k)) return null;
  return { status: s, kind: k as ReturnKind };
}
