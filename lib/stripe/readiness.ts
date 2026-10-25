import { stripeKeyMode } from "./config";
import { HANDLED_EVENT_TYPES } from "./webhook-handler";

/**
 * Stripe Test Mode 接続前の最終確認（純粋関数。Stripe APIの読み取り結果と環境変数の“有無”だけを受け取る）。
 * 実行は `npm run verify:stripe`（読み取り専用。Stripe側の設定は一切変更しない。秘密の値は出力しない）。
 */
export type Check = { id: string; level: "ok" | "fail" | "warn"; message: string };

type Env = Record<string, string | undefined>;
export type WebhookEndpointLike = { url: string; status: string; enabled_events: string[]; livemode?: boolean };
export type PortalConfigLike = {
  is_default?: boolean; is_active?: boolean;
  features: {
    payment_method_update?: { enabled?: boolean };
    invoice_history?: { enabled?: boolean };
    subscription_cancel?: { enabled?: boolean };
    subscription_update?: { enabled?: boolean };
  };
};

export function checkEnvReadiness(env: Env): Check[] {
  const out: Check[] = [];
  const key = env.STRIPE_SECRET_KEY?.trim();
  const mode = stripeKeyMode(key);
  out.push(!key ? { id: "env.secret_key", level: "fail", message: "STRIPE_SECRET_KEY が未設定です（sk_test_… を設定）。" }
    : mode === "test" ? { id: "env.secret_key", level: "ok", message: "STRIPE_SECRET_KEY はTest Modeの鍵です。" }
    : mode === "live" ? { id: "env.secret_key", level: "fail", message: "STRIPE_SECRET_KEY がLive鍵です。販売開始前のTest確認ではsk_test_…を使ってください。" }
    : { id: "env.secret_key", level: "fail", message: "STRIPE_SECRET_KEY の形式が不正です（sk_test_… / rk_test_…）。" });
  out.push(env.STRIPE_WEBHOOK_SECRET?.trim().startsWith("whsec_")
    ? { id: "env.webhook_secret", level: "ok", message: "STRIPE_WEBHOOK_SECRET が設定されています（whsec_…）。" }
    : { id: "env.webhook_secret", level: "fail", message: "STRIPE_WEBHOOK_SECRET が未設定または形式不正です（whsec_…）。" });
  const site = env.NEXT_PUBLIC_SITE_URL?.trim();
  out.push(site && /^https?:\/\//.test(site)
    ? { id: "env.site_url", level: /^https:\/\//.test(site) || /localhost|127\.0\.0\.1/.test(site) ? "ok" : "warn", message: `NEXT_PUBLIC_SITE_URL が設定されています（${new URL(site).origin}）。` }
    : { id: "env.site_url", level: "fail", message: "NEXT_PUBLIC_SITE_URL が未設定です（Checkoutの戻り先。https://…）。" });
  out.push(env.STRIPE_ALLOW_LIVE_MODE ? { id: "env.allow_live", level: "fail", message: "STRIPE_ALLOW_LIVE_MODE が設定されています。Test確認中は設定しないでください。" }
    : { id: "env.allow_live", level: "ok", message: "STRIPE_ALLOW_LIVE_MODE は未設定です（Live課金は無効）。" });
  for (const name of Object.keys(env)) {
    if (/^NEXT_PUBLIC_.*STRIPE/i.test(name) && env[name]) {
      out.push({ id: "env.public_stripe", level: "fail", message: `${name} は公開される環境変数です。Stripeの鍵・secretはNEXT_PUBLIC_に置かないでください。` });
    }
  }
  return out;
}

export function checkWebhookEndpoints(endpoints: WebhookEndpointLike[], siteUrl: string | undefined): Check[] {
  const expected = [...HANDLED_EVENT_TYPES].sort();
  const path = "/api/stripe/webhook";
  const mine = endpoints.filter((e) => e.url.endsWith(path));
  if (mine.length === 0) {
    return [{ id: "webhook.endpoint", level: "fail", message: `webhookエンドポイント（…${path}）が登録されていません。Dashboardまたは \`stripe listen\` を使ってください。` }];
  }
  const out: Check[] = [];
  for (const e of mine) {
    const label = new URL(e.url).origin + path;
    if (e.status !== "enabled") out.push({ id: "webhook.status", level: "fail", message: `${label} が無効です。` });
    if (siteUrl && new URL(e.url).origin !== new URL(siteUrl).origin) {
      out.push({ id: "webhook.origin", level: "warn", message: `${label} のドメインがNEXT_PUBLIC_SITE_URLと異なります。` });
    }
    const got = [...new Set(e.enabled_events)].sort();
    if (got.includes("*")) {
      out.push({ id: "webhook.events", level: "fail", message: `${label} が全イベント(*)を購読しています。次の${expected.length}件だけにしてください。` });
      continue;
    }
    const missing = expected.filter((t) => !got.includes(t));
    const extra = got.filter((t) => !expected.includes(t as never));
    if (missing.length === 0 && extra.length === 0) out.push({ id: "webhook.events", level: "ok", message: `${label} は必要な${expected.length}イベントだけを購読しています。` });
    else {
      if (missing.length) out.push({ id: "webhook.events", level: "fail", message: `${label} に不足イベント: ${missing.join(", ")}` });
      if (extra.length) out.push({ id: "webhook.events", level: "warn", message: `${label} に不要なイベント: ${extra.join(", ")}（処理されず無視されます）` });
    }
  }
  return out;
}

export function checkPortalConfig(configs: PortalConfigLike[]): Check[] {
  const active = configs.filter((c) => c.is_active !== false);
  const cfg = active.find((c) => c.is_default) ?? active[0];
  if (!cfg) return [{ id: "portal.config", level: "fail", message: "Customer Portalの設定がありません（Dashboardで作成・保存してください）。" }];
  const f = cfg.features;
  const want: Array<[string, boolean | undefined, boolean]> = [
    ["支払い方法の更新", f.payment_method_update?.enabled, true],
    ["請求（決済）履歴の表示", f.invoice_history?.enabled, true],
    ["プラン変更", f.subscription_update?.enabled, false],
    ["サブスクリプションの解約", f.subscription_cancel?.enabled, false],
  ];
  return want.map(([name, actual, expected]) => ({
    id: "portal.feature", level: Boolean(actual) === expected ? "ok" : "fail",
    message: `Customer Portal「${name}」は ${expected ? "ON" : "OFF"} にしてください（現在: ${actual ? "ON" : "OFF"}）。`,
  }));
}

export function checkTaxSettings(status: string | null | undefined): Check[] {
  if (!status || status === "pending") return [{ id: "tax.stripe_tax", level: "ok", message: "Stripe Taxは有効化されていません（税はBeauty Reach DBが確定）。" }];
  return [{ id: "tax.stripe_tax", level: "warn", message: "Stripe Taxが有効になっています。コードは automatic_tax=false を明示しているため二重課税にはなりませんが、Test確認では無効のままにしてください。" }];
}

export const hasFailure = (checks: Check[]) => checks.some((c) => c.level === "fail");
