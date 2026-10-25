/**
 * Stripe Test Mode 接続前の最終確認（読み取り専用）。
 *   使い方: set -a; source .env.local; set +a; npm run verify:stripe
 * ・Stripe側の設定は変更しない。秘密の値は出力しない。
 * ・STRIPE_SECRET_KEY が無い場合は、環境変数のチェックだけ行い、API確認は「未実施」と表示して終了コード1で終わる。
 */
import Stripe from "stripe";
import {
  checkEnvReadiness, checkPortalConfig, checkTaxSettings, checkWebhookEndpoints, hasFailure,
  type Check, type PortalConfigLike, type WebhookEndpointLike,
} from "../lib/stripe/readiness";

const env = process.env;
const checks: Check[] = checkEnvReadiness(env);
let apiChecked = false;

const key = env.STRIPE_SECRET_KEY?.trim();
if (key && /^(sk|rk)_test_/.test(key)) {
  const stripe = new Stripe(key);
  try {
    const [endpoints, portals] = await Promise.all([
      stripe.webhookEndpoints.list({ limit: 100 }),
      stripe.billingPortal.configurations.list({ limit: 10 }),
    ]);
    checks.push(...checkWebhookEndpoints(endpoints.data as unknown as WebhookEndpointLike[], env.NEXT_PUBLIC_SITE_URL));
    checks.push(...checkPortalConfig(portals.data as unknown as PortalConfigLike[]));
    let taxStatus: string | null = null;
    try { taxStatus = (await stripe.tax.settings.retrieve()).status; } catch { /* 権限なし/未設定は「無効」とみなす */ }
    checks.push(...checkTaxSettings(taxStatus));
    apiChecked = true;
  } catch (e) {
    checks.push({ id: "api", level: "fail", message: `Stripe APIへ接続できませんでした（${e instanceof Error ? e.message.split("\n")[0] : "unknown"}）。鍵の権限（読み取り: Webhook endpoints / Customer portal / Tax）を確認してください。` });
  }
} else {
  checks.push({ id: "api", level: "warn", message: "Stripe API確認は未実施です（有効なTest鍵が無いため）。" });
}

const mark = { ok: "[OK]  ", fail: "[NG]  ", warn: "[注意]" } as const;
for (const c of checks) console.log(`${mark[c.level]} ${c.message}`);
const failed = hasFailure(checks) || !apiChecked;
console.log(failed ? "\n結果: 未完了（上の [NG]/未実施 を解消してください）" : "\n結果: Test Mode接続の準備ができています");
process.exit(failed ? 1 : 0);
