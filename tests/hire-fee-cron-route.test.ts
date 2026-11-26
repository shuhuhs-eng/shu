// 採用料ジョブのAPI（/api/cron/hire-fee-charge）の停止の段階: ジョブ停止（環境変数）／請求停止（DB設定）／有効。実際のルートを、差し替えた依存（DB・Stripe）で動かす。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

const log: { rpc: string[]; stripeSearch: number; stripeCreate: number; serviceClient: number; stripeClient: number } = { rpc: [], stripeSearch: 0, stripeCreate: 0, serviceClient: 0, stripeClient: 0 };
const dbState = { autoCharge: true, recoverable: [] as unknown[], due: [] as unknown[] };
const fakeSupabase = {
  rpc: async (fn: string) => {
    log.rpc.push(fn);
    if (fn === "service_hire_fee_auto_charge_enabled") return { data: dbState.autoCharge, error: null };
    if (fn === "service_hire_fee_recoverable") return { data: dbState.recoverable, error: null };
    if (fn === "service_hire_fee_due") return { data: dbState.due, error: null };
    return { data: null, error: null };
  },
};
const fakeStripe = { paymentIntents: { search: async () => { log.stripeSearch++; return { data: [] }; }, create: async () => { log.stripeCreate++; throw new Error("呼ばれないはず"); } } };
const orig = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (request: string, ...rest: unknown[]) {
  if (request === "@/lib/cron/auth") return { verifyCronAuth: () => "ok" };
  if (request === "@/lib/supabase/service") return { createServiceClient: () => { log.serviceClient++; return fakeSupabase; } };
  if (request === "@/lib/stripe/client") return { getStripe: () => { log.stripeClient++; return fakeStripe; }, currentStripeLivemode: () => false };
  if (request === "@/lib/security/log") return { logError: () => undefined };
  return orig.call(this, request, ...rest);
};
after(() => { (Module as unknown as { _load: unknown })._load = orig; });
// eslint-disable-next-line @typescript-eslint/no-require-imports
const route = require("../app/api/cron/hire-fee-charge/route");
const reset = (o: Partial<typeof dbState> = {}) => { Object.assign(dbState, { autoCharge: true, recoverable: [], due: [] }, o); log.rpc = []; log.stripeSearch = 0; log.stripeCreate = 0; log.serviceClient = 0; log.stripeClient = 0; };
const call = async () => (await route.GET(new Request("http://localhost/api/cron/hire-fee-charge"))).json();

test("ジョブ停止（HIRE_BILLING_ENABLED が '1' でない。'true' も含む）: 何もしない。DBにもStripeにも触れない", async () => {
  reset(); delete process.env.HIRE_BILLING_ENABLED;
  assert.deepEqual(await call(), { ok: true, enabled: false });
  assert.deepEqual(log.rpc, []); assert.equal(log.serviceClient, 0); assert.equal(log.stripeClient, 0);
  for (const v of ["false", "0", "", "true", "TRUE", " 1", "yes"]) { process.env.HIRE_BILLING_ENABLED = v; assert.deepEqual(await call(), { ok: true, enabled: false }, `値 ${JSON.stringify(v)} はオフ`); assert.deepEqual(log.rpc, []); assert.equal(log.serviceClient, 0); assert.equal(log.stripeClient, 0); }
});
test("請求停止（DBの auto_charge_enabled が false）: 照合だけ。期日の一覧は取らず、新しい請求も再送もしない", async () => {
  reset({ autoCharge: false, recoverable: [{ attempt_id: "11111111-1111-4111-8111-111111111111", status: "in_progress", sent_at: "t", started_at: "x", age_minutes: 30, idempotency_key: "k", external_ref: null, attempt_no: 1, schedule_id: "s1" }] });
  process.env.HIRE_BILLING_ENABLED = "1";
  const r = await call();
  assert.equal(r.ok, true); assert.equal(r.billingEnabled, false); assert.equal(r.charges, null);
  assert.equal(r.recovery.found, 1); assert.equal(r.recovery.held, 1); assert.equal(r.recovery.resent, 0);
  assert.equal(log.stripeSearch, 1); assert.equal(log.stripeCreate, 0);
  assert.ok(!log.rpc.includes("service_hire_fee_due") && !log.rpc.includes("service_hire_fee_begin_charge") && !log.rpc.includes("service_hire_fee_mark_sent"));
});
test("請求が有効: 期日の一覧まで進む（対象なしなら請求は0件）", async () => {
  reset({ autoCharge: true }); process.env.HIRE_BILLING_ENABLED = "1";
  const r = await call();
  assert.equal(r.billingEnabled, true); assert.equal(r.charges.due, 0); assert.ok(log.rpc.includes("service_hire_fee_due"));
});
