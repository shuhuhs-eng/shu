import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type Stripe from "stripe";
import { buildReturnUrl, checkStripeEnv, checkStripeWebhookEnv, parseReturn, stripeKeyMode } from "../lib/stripe/config";
import { isAllowedStripeRedirect, mapStripeActionError } from "../lib/stripe/errors";
import { HANDLED_EVENT_TYPES, idOf, processStripeEvent, subscriptionFacts, type CallRpc, type HandlerDeps, type StripeApi } from "../lib/stripe/webhook-handler";
import { cardBrandLabel, formatCardExpiry, subscriptionStateLabel } from "../lib/stripe/labels";
import { collectEnvProblems } from "../lib/env/validate";

// ---------------------------------------------------------------- config / env
test("stripe鍵: test/liveを判定し、pk_や空は不正", () => {
  assert.equal(stripeKeyMode("sk_test_abc"), "test");
  assert.equal(stripeKeyMode("rk_live_abc"), "live");
  for (const bad of ["pk_test_abc", "whsec_x", "", undefined, null, "sk_abc"]) assert.equal(stripeKeyMode(bad as never), null, String(bad));
});
test("checkStripeEnv: live鍵は STRIPE_ALLOW_LIVE_MODE=true が無い限り拒否（Test Modeのみの安全弁）", () => {
  const site = "https://example.com";
  assert.deepEqual(checkStripeEnv({ STRIPE_SECRET_KEY: "sk_test_x", NEXT_PUBLIC_SITE_URL: site }), { ok: true, mode: "test", livemode: false });
  assert.deepEqual(checkStripeEnv({ STRIPE_SECRET_KEY: "sk_live_x", NEXT_PUBLIC_SITE_URL: site }), { ok: false, reason: "live_not_allowed" });
  assert.equal(checkStripeEnv({ STRIPE_SECRET_KEY: "sk_live_x", STRIPE_ALLOW_LIVE_MODE: "true", NEXT_PUBLIC_SITE_URL: site }).ok, true);
  assert.deepEqual(checkStripeEnv({ NEXT_PUBLIC_SITE_URL: site }), { ok: false, reason: "missing_key" });
  assert.deepEqual(checkStripeEnv({ STRIPE_SECRET_KEY: "pk_test_x", NEXT_PUBLIC_SITE_URL: site }), { ok: false, reason: "invalid_key" });
  assert.deepEqual(checkStripeEnv({ STRIPE_SECRET_KEY: "sk_test_x" }), { ok: false, reason: "missing_site_url" });
});
test("checkStripeWebhookEnv: webhook secret が無ければ不可", () => {
  assert.deepEqual(checkStripeWebhookEnv({ STRIPE_SECRET_KEY: "sk_test_x" }), { ok: false, reason: "missing_webhook_secret" });
  assert.deepEqual(checkStripeWebhookEnv({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x" }), { ok: true, livemode: false });
});
test("env検証: Stripe鍵は本番で必須、live鍵は許可フラグ必須、値は出力しない", () => {
  const prod = collectEnvProblems({}, true);
  assert.ok(prod.some((p) => p.key === "STRIPE_SECRET_KEY" && p.level === "error"));
  assert.ok(prod.some((p) => p.key === "STRIPE_WEBHOOK_SECRET" && p.level === "error"));
  assert.ok(collectEnvProblems({ STRIPE_SECRET_KEY: "pk_live_SECRETVALUE" }, true).some((p) => p.key === "STRIPE_SECRET_KEY" && /形式/.test(p.message)));
  assert.ok(collectEnvProblems({ STRIPE_SECRET_KEY: "sk_live_abc" }, true).some((p) => p.key === "STRIPE_ALLOW_LIVE_MODE"));
  assert.ok(!collectEnvProblems({ STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_ALLOW_LIVE_MODE: "true" }, true).some((p) => p.key === "STRIPE_ALLOW_LIVE_MODE"));
  assert.ok(collectEnvProblems({ STRIPE_WEBHOOK_SECRET: "oops" }, true).some((p) => p.key === "STRIPE_WEBHOOK_SECRET" && /whsec_/.test(p.message)));
  assert.ok(collectEnvProblems({ STRIPE_SECRET_KEY: "sk_live_SECRETVALUE" }, true).every((p) => !p.message.includes("SECRETVALUE")));
  assert.ok(collectEnvProblems({}, false).every((p) => p.level === "warn"));
});
test("戻り先URLは自サイトの請求ページだけ。戻りクエリは検証される", () => {
  assert.equal(buildReturnUrl("https://x.example/", { stripe: "success", kind: "card" }), "https://x.example/salon/company/billing?stripe=success&kind=card");
  assert.deepEqual(parseReturn({ stripe: "success", kind: "success_fee" }), { status: "success", kind: "success_fee" });
  assert.equal(parseReturn({ stripe: "success", kind: "evil" }), null);
  assert.equal(parseReturn({ stripe: "paid", kind: "card" }), null);
  assert.equal(parseReturn({}), null);
});
test("Stripeの遷移先はホスティング画面のhttpsのみ許可", () => {
  assert.equal(isAllowedStripeRedirect("https://checkout.stripe.com/c/pay/cs_test_x"), true);
  assert.equal(isAllowedStripeRedirect("https://billing.stripe.com/p/session/x"), true);
  for (const bad of ["http://checkout.stripe.com/x", "https://evil.com/x", "https://checkout.stripe.com.evil.com/x", "javascript:alert(1)", "", null, undefined]) {
    assert.equal(isAllowedStripeRedirect(bad as never), false, String(bad));
  }
});
test("エラー文言: 内部情報を出さず、日本語に変換", () => {
  assert.match(mapStripeActionError("contract not active"), /契約/);
  assert.match(mapStripeActionError("success fee is not payable"), /カードで支払える状態ではありません/);
  assert.match(mapStripeActionError("stripe not configured: missing_key"), /準備中/);
  const unknown = mapStripeActionError('duplicate key value violates unique constraint "x" (cus_123)');
  assert.ok(!unknown.includes("cus_123") && !unknown.includes("duplicate key"));
});
test("表示文言: カードはブランド・下4桁・有効期限のみ想定、状態ラベル", () => {
  assert.equal(cardBrandLabel("visa"), "Visa");
  assert.equal(cardBrandLabel("jcb"), "JCB");
  assert.equal(formatCardExpiry(3, 2028), "03/28");
  assert.equal(subscriptionStateLabel("past_due"), "お支払いが遅れています（自動で再試行中）");
  assert.equal(subscriptionStateLabel(null), "未設定");
});

// ---------------------------------------------------------------- webhook handler
type Call = { fn: string; args: Record<string, unknown> };
function makeDeps(opts: { rpcResults?: Record<string, { result: string }>; livemode?: boolean; sub?: Partial<Stripe.Subscription>; pms?: string[] } = {}) {
  const calls: Call[] = [];
  const stripeCalls: string[] = [];
  const callRpc: CallRpc = async (fn, args) => {
    calls.push({ fn, args: args as Record<string, unknown> });
    return (opts.rpcResults?.[fn] ?? { result: "applied" }) as never;
  };
  const sub = {
    id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: false,
    default_payment_method: "pm_9", metadata: { beauty_reach_purpose: "monthly_subscription" },
    items: { data: [{ current_period_start: 1_700_000_000, current_period_end: 1_702_592_000, quantity: 1, price: { unit_amount: 50000, currency: "jpy" } }] },
    ...opts.sub,
  } as unknown as Stripe.Subscription;
  const stripe: StripeApi = {
    setupIntentPaymentMethod: async () => { stripeCalls.push("setupIntent"); return "pm_new"; },
    retrieveSubscription: async () => { stripeCalls.push("retrieveSubscription"); return sub; },
    setCustomerDefaultPaymentMethod: async (c, pm) => { stripeCalls.push(`default:${c}:${pm}`); },
    listCustomerCardPaymentMethods: async () => { stripeCalls.push("listPMs"); return opts.pms ?? []; },
  };
  const deps: HandlerDeps = { callRpc, stripe, now: () => new Date("2026-10-24T00:00:00Z"), expectedLivemode: opts.livemode ?? false };
  return { deps, calls, stripeCalls };
}
const ev = (type: string, object: unknown, extra: Record<string, unknown> = {}) =>
  ({ id: "evt_1", type, livemode: false, created: 1_700_000_100, data: { object }, ...extra }) as unknown as Stripe.Event;

test("webhook: 対象イベント一覧にpayment_method_types系の依存が無く、必要イベントを網羅", () => {
  for (const t of ["checkout.session.completed", "invoice.paid", "invoice.payment_failed", "customer.subscription.updated", "customer.subscription.deleted"]) {
    assert.ok((HANDLED_EVENT_TYPES as readonly string[]).includes(t), t);
  }
});
test("webhook: livemode不一致のイベントは何も処理しない", async () => {
  const { deps, calls } = makeDeps({ livemode: true });
  const r = await processStripeEvent(ev("checkout.session.completed", { id: "cs_1", metadata: { checkout_record_id: "r", purpose: "success_fee" }, customer: "cus_1" }), deps);
  assert.equal(r.result, "ignored");
  assert.equal(calls.length, 0);
});
test("webhook: 成功報酬カード決済は“Stripeの実額”をそのままRPCへ渡す（metadata金額は存在しない/信用しない）", async () => {
  const { deps, calls } = makeDeps();
  const session = { id: "cs_1", customer: "cus_1", payment_intent: "pi_1", amount_total: 366666, currency: "jpy", payment_status: "paid", status: "complete",
    metadata: { checkout_record_id: "rec-1", purpose: "success_fee", success_fee_id: "fee-1", organization_id: "org-evil", amount: "1" } };
  const r = await processStripeEvent(ev("checkout.session.completed", session), deps);
  assert.equal(r.result, "processed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.fn, "apply_success_fee_card_payment");
  assert.deepEqual(calls[0]!.args, {
    p_checkout_record_id: "rec-1", p_session_id: "cs_1", p_customer_id: "cus_1", p_payment_intent_id: "pi_1",
    p_amount_total: 366666, p_currency: "jpy", p_payment_status: "paid", p_event_id: "evt_1",
  });
  assert.ok(!JSON.stringify(calls).includes("org-evil"), "metadata の organization_id はRPCへ渡さない");
});
test("webhook: 未払い(unpaid)・integrity_issueの結果を正しく分類", async () => {
  const unpaid = makeDeps({ rpcResults: { apply_success_fee_card_payment: { result: "not_paid" } } });
  const session = { id: "cs_1", customer: "cus_1", payment_intent: null, amount_total: 1, currency: "jpy", payment_status: "unpaid", status: "complete", metadata: { checkout_record_id: "r", purpose: "success_fee" } };
  assert.equal((await processStripeEvent(ev("checkout.session.completed", session), unpaid.deps)).result, "ignored");
  const bad = makeDeps({ rpcResults: { apply_success_fee_card_payment: { result: "integrity_issue" } } });
  assert.equal((await processStripeEvent(ev("checkout.session.completed", { ...session, payment_status: "paid" }), bad.deps)).result, "integrity_issue");
});
test("webhook: 追加スカウト枠は専用RPC、他purposeのレコードを流用しない", async () => {
  const { deps, calls } = makeDeps();
  const session = { id: "cs_2", customer: "cus_1", payment_intent: "pi_2", amount_total: 1000, currency: "jpy", payment_status: "paid", status: "complete", metadata: { checkout_record_id: "r2", purpose: "scout_credits" } };
  await processStripeEvent(ev("checkout.session.completed", session), deps);
  assert.equal(calls[0]!.fn, "apply_scout_credit_payment");
});
test("webhook: 自社のCheckoutでないセッション(metadataなし)は無視", async () => {
  const { deps, calls } = makeDeps();
  const r = await processStripeEvent(ev("checkout.session.completed", { id: "cs_x", customer: "cus_1", metadata: {} }), deps);
  assert.equal(r.result, "ignored");
  assert.equal(calls.length, 0);
});
test("webhook: カード登録(setup)はSetupIntentからPMを取得し、適用後にStripe既定カードも揃える（再送でも同じ）", async () => {
  for (const result of ["applied", "already_applied"]) {
    const { deps, calls, stripeCalls } = makeDeps({ rpcResults: { apply_payment_method_setup: { result } } });
    const session = { id: "cs_s", customer: "cus_1", setup_intent: "seti_1", status: "complete", metadata: { checkout_record_id: "rs", purpose: "payment_method_setup" } };
    const r = await processStripeEvent(ev("checkout.session.completed", session), deps);
    assert.equal(r.result, "processed");
    assert.equal(calls[0]!.fn, "apply_payment_method_setup");
    assert.equal(calls[0]!.args.p_payment_method_id, "pm_new");
    assert.deepEqual(stripeCalls, ["setupIntent", "default:cus_1:pm_new"]);
  }
  const bad = makeDeps({ rpcResults: { apply_payment_method_setup: { result: "integrity_issue" } } });
  const r = await processStripeEvent(ev("checkout.session.completed", { id: "cs_s", customer: "cus_1", setup_intent: "seti_1", status: "complete", metadata: { checkout_record_id: "rs", purpose: "payment_method_setup" } }), bad.deps);
  assert.equal(r.result, "integrity_issue");
  assert.ok(!bad.stripeCalls.some((c) => c.startsWith("default:")), "不整合のときはStripe既定カードを変更しない");
});
test("webhook: 月額Checkout完了→サブスクを取得してsnapshot反映・カード登録済みを記録", async () => {
  const { deps, calls } = makeDeps();
  const session = { id: "cs_m", customer: "cus_1", subscription: "sub_1", status: "complete", metadata: { checkout_record_id: "rm", purpose: "monthly_subscription" } };
  const r = await processStripeEvent(ev("checkout.session.completed", session), deps);
  assert.equal(r.result, "processed");
  assert.deepEqual(calls.map((c) => c.fn), ["apply_subscription_checkout_completed", "apply_stripe_subscription_snapshot", "set_payment_method_state"]);
  assert.equal(calls[1]!.args.p_amount, 50000);
  assert.equal(calls[1]!.args.p_currency, "jpy");
});
test("webhook: subscription更新は通知内容ではなく取得した最新オブジェクトを反映。自社以外のサブスクは無視", async () => {
  const { deps, calls, stripeCalls } = makeDeps({ sub: { status: "past_due" } });
  const stale = { id: "sub_1", customer: "cus_1", status: "active", metadata: { beauty_reach_purpose: "monthly_subscription" } };
  const r = await processStripeEvent(ev("customer.subscription.updated", stale), deps);
  assert.equal(r.result, "processed");
  assert.deepEqual(stripeCalls, ["retrieveSubscription"]);
  assert.equal(calls[0]!.args.p_status, "past_due", "古い通知のstatus(active)ではなく最新(past_due)");
  assert.equal(calls[0]!.args.p_retrieved_at, "2026-10-24T00:00:00.000Z");
  const other = makeDeps();
  const r2 = await processStripeEvent(ev("customer.subscription.updated", { id: "sub_z", customer: "cus_1", metadata: {} }), other.deps);
  assert.equal(r2.result, "ignored");
  assert.equal(other.calls.length, 0);
});
test("webhook: invoice.paid/failed はsnapshotを先に反映してから支払い結果を記録", async () => {
  for (const [type, expected] of [["invoice.paid", "succeeded"], ["invoice.payment_failed", "failed"]] as const) {
    const { deps, calls } = makeDeps();
    const invoice = { id: "in_1", customer: "cus_1", parent: { subscription_details: { subscription: "sub_1" } } };
    const r = await processStripeEvent(ev(type, invoice), deps);
    assert.equal(r.result, "processed");
    assert.deepEqual(calls.map((c) => c.fn), ["apply_stripe_subscription_snapshot", "apply_stripe_invoice_result"]);
    assert.equal(calls[1]!.args.p_result, expected);
    assert.equal(calls[1]!.args.p_event_at, new Date(1_700_000_100 * 1000).toISOString());
  }
  const none = makeDeps();
  assert.equal((await processStripeEvent(ev("invoice.paid", { id: "in_2", customer: "cus_1", parent: null }), none.deps)).result, "ignored");
});
test("webhook: 支払い失敗でも契約状態を変えるRPCは呼ばない（決済状態のみ）", async () => {
  const { deps, calls } = makeDeps({ sub: { status: "unpaid" } });
  await processStripeEvent(ev("invoice.payment_failed", { id: "in_1", customer: "cus_1", parent: { subscription_details: { subscription: "sub_1" } } }), deps);
  assert.ok(calls.every((c) => c.fn === "apply_stripe_subscription_snapshot" || c.fn === "apply_stripe_invoice_result"));
});
test("webhook: 返金/チャージバックは確認事項として記録(integrity_issue)。自動で入金を戻さない", async () => {
  const { deps, calls } = makeDeps({ rpcResults: { record_stripe_refund_or_dispute: { result: "recorded" } } });
  assert.equal((await processStripeEvent(ev("charge.refunded", { id: "ch_1", payment_intent: "pi_1" }), deps)).result, "integrity_issue");
  assert.equal((await processStripeEvent(ev("charge.dispute.created", { id: "dp_1", payment_intent: "pi_1" }), deps)).result, "integrity_issue");
  assert.deepEqual(calls.map((c) => c.fn), ["record_stripe_refund_or_dispute", "record_stripe_refund_or_dispute"]);
  const unknown = makeDeps({ rpcResults: { record_stripe_refund_or_dispute: { result: "ignored" } } });
  assert.equal((await processStripeEvent(ev("charge.refunded", { id: "ch_2", payment_intent: "pi_x" }), unknown.deps)).result, "ignored");
});
test("webhook: payment_method.detached は残りのカードを確認して有無を反映", async () => {
  const none = makeDeps({ pms: [] });
  await processStripeEvent(ev("payment_method.detached", { id: "pm_1", customer: null }, { data: { object: { id: "pm_1", customer: null }, previous_attributes: { customer: "cus_1" } } }), none.deps);
  assert.equal(none.calls[0]!.args.p_available, false);
  const some = makeDeps({ pms: ["pm_2"] });
  await processStripeEvent(ev("payment_method.detached", { id: "pm_1" }, { data: { object: { id: "pm_1" }, previous_attributes: { customer: "cus_1" } } }), some.deps);
  assert.deepEqual([some.calls[0]!.args.p_available, some.calls[0]!.args.p_payment_method_id], [true, "pm_2"]);
});
test("webhook: 未知のイベントは無視、RPCが例外ならそのまま投げる（500→Stripeが再送）", async () => {
  const { deps, calls } = makeDeps();
  assert.equal((await processStripeEvent(ev("customer.created", {}), deps)).result, "ignored");
  assert.equal(calls.length, 0);
  const failing: HandlerDeps = { ...deps, callRpc: async () => { throw new Error("db down"); } };
  await assert.rejects(processStripeEvent(ev("checkout.session.expired", { id: "cs_1", metadata: { checkout_record_id: "r" } }), failing), /db down/);
});
test("subscriptionFacts / idOf", () => {
  const { deps } = makeDeps();
  void deps;
  const facts = subscriptionFacts({ items: { data: [{ current_period_start: 1, current_period_end: 2, quantity: 2, price: { unit_amount: 100, currency: "jpy" } }] } } as unknown as Stripe.Subscription);
  assert.equal(facts.amount, 200);
  assert.equal(facts.periodStart, new Date(1000).toISOString());
  assert.equal(idOf({ id: "x" }), "x");
  assert.equal(idOf("y"), "y");
  assert.equal(idOf(null), null);
});

// ---------------------------------------------------------------- static guards on source
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", "tests"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const sources = ["app", "lib", "components"].flatMap((d) => walk(d)).map((p) => ({ p, text: readFileSync(p, "utf8") }));
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("静的検査: payment_method_types を指定するコードが無い（Stripe API 2026-09-30.endiveで廃止）", () => {
  for (const s of sources) assert.ok(!/payment_method_types/.test(code(s.text)), s.p);
});
test("静的検査: Stripe秘密鍵/webhook secretは server 側ファイルだけが参照し、NEXT_PUBLICに置かない", () => {
  const allowed = ["lib/stripe/client.ts", "lib/stripe/config.ts", "app/api/stripe/webhook/route.ts", "lib/env/validate.ts"];
  for (const s of sources) {
    const t = code(s.text);
    assert.ok(!/NEXT_PUBLIC_STRIPE/.test(t), `${s.p}: NEXT_PUBLIC_STRIPE を使わない`);
    if (/STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET/.test(t)) assert.ok(allowed.includes(s.p), `${s.p}: 秘密鍵を参照してよいファイルではない`);
    if (/^["']use client["']/m.test(s.text)) assert.ok(!/STRIPE_(SECRET|WEBHOOK)|from ["']stripe["']|lib\/stripe\/(client|checkout|queries)/.test(t), `${s.p}: client componentがサーバー専用を参照`);
  }
});
test("静的検査: Stripe SDKを読み込むのはサーバー専用ファイル/型importのみ", () => {
  for (const s of sources) {
    if (!/from ["']stripe["']/.test(s.text)) continue;
    const isTypeOnly = /import type Stripe from ["']stripe["']/.test(s.text) && !/import Stripe from ["']stripe["']/.test(s.text);
    assert.ok(isTypeOnly || /import "server-only"/.test(s.text), `${s.p}: server-onlyでない実体import`);
  }
});
test("静的検査: webhookルートは生bodyをtext()で読み署名検証し、payloadやsignatureをログに出さない", () => {
  const route = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
  assert.match(route, /request\.text\(\)/);
  assert.match(route, /constructEvent\(rawBody, signature/);
  assert.ok(!/console\.(log|error)\([^)]*(rawBody|signature|payload)/.test(code(route)));
  assert.ok(!/request\.json\(\)/.test(code(route)));
});
test("静的検査: Checkout金額はRPCの返り値(DB確定値)だけ。入力schemaに金額フィールドが無い", () => {
  const actions = readFileSync("lib/stripe/actions.ts", "utf8");
  assert.ok(!/amount|price|total/i.test(code(actions).replace(/priceAmount/g, "")), "server actionの入力に金額を受け取らない");
  const checkout = readFileSync("lib/stripe/checkout.ts", "utf8");
  // 金額は純粋ビルダー(session-params.ts)経由。checkout.ts側にunit_amountの直書きは無い。
  assert.match(checkout, /buildMonthlySessionParams\(data\)/);
  assert.match(checkout, /buildSuccessFeeSessionParams\(data\)/);
  assert.match(checkout, /buildScoutCreditSessionParams\(data\)/);
  const params = readFileSync("lib/stripe/session-params.ts", "utf8");
  assert.equal((params.match(/unit_amount: data\.total_amount/g) ?? []).length, 3, "3種すべて税込total_amountを渡す");
  assert.ok(!/unit_amount: data\.(monthly_fee|price_amount|monthly_fee_excl_tax|amount_excl_tax|price_excl_tax)/.test(params), "税抜額をStripeへ渡さない");
});
test("静的検査: Stripe Tax / tax_rates を使わず automatic_tax を明示的に無効化（二重課税防止）", () => {
  const params = readFileSync("lib/stripe/session-params.ts", "utf8");
  assert.equal((params.match(/automatic_tax: NO_STRIPE_TAX/g) ?? []).length, 3);
  assert.match(params, /NO_STRIPE_TAX = \{ enabled: false \}/);
  for (const s of sources) {
    const c = code(s.text);
    assert.ok(!/tax_rates|tax_id_collection|tax_behavior|automatic_tax: \{ enabled: true/.test(c), `${s.p}: Stripe側の税機能を使わない`);
  }
});

// ---------------------------------------------------------------- 税込額がStripeへ渡ること（SDKの実リクエスト）
import { buildMonthlySessionParams, buildScoutCreditSessionParams, buildSuccessFeeSessionParams } from "../lib/stripe/session-params";
import { previewTax } from "../lib/stripe/tax-preview";

async function sdkRequestBody(params: Stripe.Checkout.SessionCreateParams): Promise<URLSearchParams> {
  const { default: StripeSdk } = await import("stripe");
  let body = "";
  const fetchFn = (async (_url: unknown, init?: { body?: unknown }) => {
    body = String(init?.body ?? "");
    return new Response(JSON.stringify({ id: "cs_test_mock", object: "checkout.session", url: "https://checkout.stripe.test/x" }), { status: 200, headers: { "content-type": "application/json", "request-id": "req_mock" } });
  }) as unknown as typeof fetch;
  const stripe = new StripeSdk("sk_test_dummy", { httpClient: StripeSdk.createFetchHttpClient(fetchFn), maxNetworkRetries: 0 });
  await stripe.checkout.sessions.create({ ...params, customer: "cus_mock", success_url: "https://example.com/s", cancel_url: "https://example.com/c" });
  return new URLSearchParams(body);
}
test("Stripe SDK: 月額 税抜10,000円 → Stripeへ税込11,000円（recurring monthly）", async () => {
  const q = await sdkRequestBody(buildMonthlySessionParams({ record_id: "r1", monthly_fee_excl_tax: 10000, tax_amount: 1000, total_amount: 11000 }));
  assert.equal(q.get("line_items[0][price_data][unit_amount]"), "11000");
  assert.equal(q.get("line_items[0][price_data][recurring][interval]"), "month");
  assert.equal(q.get("line_items[0][price_data][currency]"), "jpy");
  assert.equal(q.get("automatic_tax[enabled]"), "false");
  assert.match(q.get("line_items[0][price_data][product_data][name]") ?? "", /税込/);
  assert.ok(![...q.keys()].some((k) => /tax_rates/.test(k)));
});
test("Stripe SDK: Scoutパッケージ 税抜5,000円 → Stripeへ税込5,500円", async () => {
  const q = await sdkRequestBody(buildScoutCreditSessionParams({ record_id: "r2", label: "テスト", credits: 10, total_amount: 5500 }));
  assert.equal(q.get("line_items[0][price_data][unit_amount]"), "5500");
  assert.equal(q.get("automatic_tax[enabled]"), "false");
  assert.equal(q.get("mode"), "payment");
});
test("Stripe SDK: 成功報酬は hiring_success_fees.total_amount をそのまま渡す（再計算しない）", async () => {
  const q = await sdkRequestBody(buildSuccessFeeSessionParams({ record_id: "r3", success_fee_id: "f1", organization_id: "o1", invoice_number: "BR-2026-000001", total_amount: 366666 }));
  assert.equal(q.get("line_items[0][price_data][unit_amount]"), "366666");
  assert.equal(q.get("automatic_tax[enabled]"), "false");
});
test("税額プレビュー: DBと同じ1円未満切り捨て（10,000→1,000 / 5,000→500 / 12,345→1,234 / 8%）", () => {
  assert.deepEqual(previewTax(10000, 10), { tax: 1000, total: 11000 });
  assert.deepEqual(previewTax(5000, 10), { tax: 500, total: 5500 });
  assert.deepEqual(previewTax(12345, 10), { tax: 1234, total: 13579 });
  assert.deepEqual(previewTax(1999, 8), { tax: 159, total: 2158 });
  assert.deepEqual(previewTax(9, 10), { tax: 0, total: 9 });
  assert.deepEqual(previewTax(NaN, 10), { tax: 0, total: 0 });
});

// ---------------------------------------------------------------- 署名検証（Stripe SDKの実処理）
test("署名検証: 正しい署名は通り、本文改ざん・別secret・古いタイムスタンプは拒否", async () => {
  const { default: StripeSdk } = await import("stripe");
  const stripe = new StripeSdk("sk_test_dummy");
  const secret = "whsec_testsecret";
  const payload = JSON.stringify({ id: "evt_sig1", object: "event", type: "invoice.paid", livemode: false, created: 1, data: { object: {} } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  assert.equal(stripe.webhooks.constructEvent(payload, header, secret).id, "evt_sig1");
  assert.throws(() => stripe.webhooks.constructEvent(payload.replace("evt_sig1", "evt_sig2"), header, secret), /signature/i);
  assert.throws(() => stripe.webhooks.constructEvent(payload, header, "whsec_other"), /signature/i);
  const old = stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: Math.floor(Date.now() / 1000) - 3600 });
  assert.throws(() => stripe.webhooks.constructEvent(payload, old, secret), /tolerance|timestamp/i);
  assert.throws(() => stripe.webhooks.constructEvent(payload, "", secret), /signature/i);
});
