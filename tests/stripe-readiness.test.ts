import test from "node:test";
import assert from "node:assert/strict";
import { checkEnvReadiness, checkPortalConfig, checkTaxSettings, checkWebhookEndpoints, hasFailure } from "../lib/stripe/readiness";
import { HANDLED_EVENT_TYPES } from "../lib/stripe/webhook-handler";

const goodEnv = { STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_WEBHOOK_SECRET: "whsec_x", NEXT_PUBLIC_SITE_URL: "https://example.com" };

test("handled events are the 11 expected", () => { assert.equal(new Set(HANDLED_EVENT_TYPES).size, 11); });
test("env ok", () => { assert.equal(hasFailure(checkEnvReadiness(goodEnv)), false); });
test("env missing values fail", () => { assert.equal(checkEnvReadiness({}).filter((c) => c.level === "fail").length, 3); });
test("live key and allow-live fail", () => {
  assert.ok(hasFailure(checkEnvReadiness({ ...goodEnv, STRIPE_SECRET_KEY: "sk_live_abc" })));
  assert.ok(hasFailure(checkEnvReadiness({ ...goodEnv, STRIPE_ALLOW_LIVE_MODE: "true" })));
});
test("secret never printed", () => {
  const text = checkEnvReadiness(goodEnv).map((c) => c.message).join("\n");
  assert.ok(!text.includes("sk_test_abc") && !text.includes("whsec_x"));
});
test("webhook endpoint events", () => {
  const url = "https://example.com/api/stripe/webhook";
  assert.ok(hasFailure(checkWebhookEndpoints([], undefined)));
  assert.equal(hasFailure(checkWebhookEndpoints([{ url, status: "enabled", enabled_events: [...HANDLED_EVENT_TYPES] }], goodEnv.NEXT_PUBLIC_SITE_URL)), false);
  assert.ok(hasFailure(checkWebhookEndpoints([{ url, status: "enabled", enabled_events: ["invoice.paid"] }], undefined)));
  assert.ok(hasFailure(checkWebhookEndpoints([{ url, status: "enabled", enabled_events: ["*"] }], undefined)));
  assert.ok(hasFailure(checkWebhookEndpoints([{ url, status: "disabled", enabled_events: [...HANDLED_EVENT_TYPES] }], undefined)));
});
test("portal settings", () => {
  const ok = { is_default: true, features: { payment_method_update: { enabled: true }, invoice_history: { enabled: true }, subscription_cancel: { enabled: false }, subscription_update: { enabled: false } } };
  assert.equal(hasFailure(checkPortalConfig([ok])), false);
  assert.ok(hasFailure(checkPortalConfig([{ ...ok, features: { ...ok.features, subscription_cancel: { enabled: true } } }])));
  assert.ok(hasFailure(checkPortalConfig([])));
});
test("tax", () => {
  assert.equal(checkTaxSettings(null)[0].level, "ok");
  assert.equal(checkTaxSettings("active")[0].level, "warn");
});
