import test from "node:test";
import assert from "node:assert/strict";
import { IDEMPOTENCY_SAFE_MINUTES, resultOfIntent, runHireFeeCharges, runHireFeeJob, runHireFeeRecovery, type ChargeInfo, type DueRow, type HireChargeDb, type HireChargeStripe, type IntentLite, type Recoverable } from "../lib/billing/hire-charge";
import { faultFromEnv } from "../lib/billing/hire-charge-adapters";
import { processStripeEvent, HANDLED_EVENT_TYPES, type HandlerDeps } from "../lib/stripe/webhook-handler";
import type Stripe from "stripe";

const info = (o: Partial<ChargeInfo> = {}): ChargeInfo => ({ attempt_id: "at1", idempotency_key: "hirefee:s1:1", attempt_no: 1, total_amount: 605000, schedule_id: "s1", agreement_id: "a1", organization_id: "o1", stripe_customer_id: "cus_1", payment_method_id: "pm_1", livemode: false, ...o });
const intent = (o: Partial<IntentLite> = {}): IntentLite => ({ paymentIntentId: "pi_1", status: "succeeded", amount: 605000, currency: "jpy", customerId: "cus_1", livemode: false, scheduleId: "s1", ...o });
type Rec = [string, string, string | null];
function mk(over: { info?: ChargeInfo | null; begin?: (id: string) => unknown; charge?: HireChargeStripe["charge"]; found?: IntentLite | null; due?: DueRow[][]; marked?: boolean; recoverable?: Recoverable[]; applyResult?: string; enabled?: boolean | "throw" } = {}) {
  const rec: Rec[] = []; const charges: ChargeArgsLike[] = []; const applied: unknown[] = []; const dueCalls: (DueRow | null)[] = []; let marks = 0;
  const pages = over.due ?? [[{ id: "s1", key_date: "2026-11-24" }]];
  const db: HireChargeDb = {
    due: async (_l, after) => { dueCalls.push(after); return pages[dueCalls.length - 1] ?? []; },
    begin: async (id) => ((over.begin?.(id)) as never) ?? { attempt_id: "at1" },
    info: async () => (over.info === undefined ? info() : over.info),
    markSent: async () => { marks++; return over.marked ?? true; },
    record: async (a, r, ref) => { rec.push([a, r, ref]); },
    recoverable: async () => over.recoverable ?? [],
    autoChargeEnabled: async () => { if (over.enabled === "throw") throw new Error("db down"); return over.enabled ?? true; },
    applyFacts: async (a) => { applied.push(a); return over.applyResult ?? "applied"; },
  };
  const stripe: HireChargeStripe = {
    charge: async (a) => { charges.push(a); return over.charge ? over.charge(a) : intent(); },
    findByAttempt: async () => (over.found === undefined ? null : over.found),
  };
  return { db, stripe, rec, charges, applied, dueCalls, marks: () => marks };
}
type ChargeArgsLike = { idempotencyKey: string; amountYen: number; metadata: Record<string, string> };
const rcv = (o: Partial<Recoverable> = {}): Recoverable => ({ attempt_id: "at1", status: "in_progress", sent_at: null, started_at: "x", age_minutes: 30, idempotency_key: "hirefee:s1:1", external_ref: null, attempt_no: 1, schedule_id: "s1", ...o });
const LIVE = { expectedLivemode: false, allowResend: true };   // 復旧の再送を許す実行（請求が有効なとき）
const LOOKUP_ONLY = { expectedLivemode: false };            // 照合だけ（請求停止中）

test("結果の対応: succeeded→成功、拒否・要支払方法→失敗、処理中・要認証→結果不明（再請求しない）", () => {
  assert.deepEqual(resultOfIntent(intent()), { result: "succeeded", ref: "pi_1" });
  assert.deepEqual(resultOfIntent(intent({ status: "requires_payment_method" })), { result: "failed", ref: "pi_1" });
  assert.deepEqual(resultOfIntent({ declined: true, intent: null }), { result: "failed", ref: null });
  assert.equal(resultOfIntent(intent({ status: "processing" })).result, "unknown");
  assert.equal(resultOfIntent(intent({ status: "requires_action" })).result, "unknown");
});
test("請求ジョブ: 成功は送信の印→冪等キー・試行IDつきで1回だけ請求→外部IDを記録", async () => {
  const m = mk(); const s = await runHireFeeCharges({ db: m.db, stripe: m.stripe, ...LIVE });
  assert.deepEqual(s, { due: 1, succeeded: 1, failed: 0, unknown: 0, skipped: 0, errors: 0, pages: 1 });
  assert.equal(m.marks(), 1); assert.equal(m.charges.length, 1); assert.deepEqual(m.rec, [["at1", "succeeded", "pi_1"]]);
  assert.equal(m.charges[0].idempotencyKey, "hirefee:s1:1");
});
test("請求ジョブ: 通信断は結果不明として記録し、再請求しない", async () => {
  const m = mk({ charge: async () => { throw new Error("network"); } });
  const s = await runHireFeeCharges({ db: m.db, stripe: m.stripe, ...LIVE });
  assert.equal(s.unknown, 1); assert.deepEqual(m.rec, [["at1", "unknown", null]]); assert.equal(m.charges.length, 1);
});
test("請求ジョブ: カード拒否は失敗として記録", async () => {
  const m = mk({ charge: async () => ({ declined: true, intent: intent({ status: "requires_payment_method", paymentIntentId: "pi_9" }) }) });
  await runHireFeeCharges({ db: m.db, stripe: m.stripe, ...LIVE });
  assert.deepEqual(m.rec, [["at1", "failed", "pi_9"]]);
});
test("請求ジョブ: 支払い方法なし・モード違いなら請求せず失敗として記録", async () => {
  for (const i of [info({ payment_method_id: null }), info({ livemode: true }), null]) {
    const m = mk({ info: i }); const s = await runHireFeeCharges({ db: m.db, stripe: m.stripe, ...LIVE });
    assert.equal(m.charges.length, 0); assert.equal(s.failed, 1); assert.deepEqual(m.rec, [["at1", "failed", null]]);
  }
});
test("請求ジョブ: 開始できなかった（skipped）ものは請求しない・記録しない", async () => {
  const m = mk({ begin: () => ({ skipped: "not chargeable" }) }); const s = await runHireFeeCharges({ db: m.db, stripe: m.stripe, ...LIVE });
  assert.equal(s.skipped, 1); assert.equal(m.charges.length, 0); assert.equal(m.rec.length, 0);
});
test("請求ジョブ: 成功なのに決済IDが空なら成功にせず結果不明", async () => {
  const m = mk({ charge: async () => intent({ paymentIntentId: "" }) });
  await runHireFeeCharges({ db: m.db, stripe: m.stripe, ...LIVE });
  assert.deepEqual(m.rec, [["at1", "unknown", null]]);
});
test("請求ジョブ: 送信の印を付けられない（進行中でない）なら送らない", async () => {
  const m = mk({ marked: false }); const s = await runHireFeeCharges({ db: m.db, stripe: m.stripe, ...LIVE });
  assert.equal(m.charges.length, 0); assert.equal(m.rec.length, 0); assert.equal(s.errors, 1);
});
test("請求ジョブ: 1件の例外で他の件を止めない", async () => {
  let n = 0; const m = mk({ due: [[{ id: "s1", key_date: "d" }, { id: "s2", key_date: "d" }]], begin: () => { if (n++ === 0) throw new Error("db"); return { attempt_id: "at2" }; } });
  const s = await runHireFeeCharges({ db: m.db, stripe: m.stripe, ...LIVE });
  assert.equal(s.errors, 1); assert.equal(s.succeeded, 1);
});
test("請求ジョブ: 先頭のページが開始できない案件で埋まっても、カーソルで次のページへ進み後続を請求する", async () => {
  const page = (p: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, key_date: "2026-11-24" }));
  const m = mk({ due: [page("a", 3), page("b", 3), page("c", 1)], begin: (id) => (id.startsWith("a") ? { skipped: "livemode mismatch" } : { attempt_id: "at-" + id }) });
  const s = await runHireFeeCharges({ db: m.db, stripe: m.stripe, ...LIVE, limit: 3 });
  assert.equal(s.skipped, 3); assert.equal(s.succeeded, 4); assert.equal(s.pages, 3);
  assert.deepEqual(m.dueCalls, [null, { id: "a2", key_date: "2026-11-24" }, { id: "b2", key_date: "2026-11-24" }]);
});
test("請求ジョブ: 時間切れ・ページ上限で打ち切る（残りは次回）", async () => {
  let t = 0; const m = mk({ due: [[{ id: "s1", key_date: "d" }, { id: "s2", key_date: "d" }], [{ id: "s3", key_date: "d" }]] });
  const s = await runHireFeeCharges({ db: m.db, stripe: m.stripe, ...LIVE, limit: 2, deadlineMs: 5, now: () => (t += 3) });
  assert.ok(s.succeeded < 3);
});
// ---- 故障の再現（試験用）
test("故障再現 stop_before_send: 印の後・送信の前に停止 → Stripeへ送らず、試行は進行中のまま（記録なし）", async () => {
  const m = mk(); const s = await runHireFeeCharges({ db: m.db, stripe: m.stripe, ...LIVE, fault: "stop_before_send" });
  assert.equal(m.marks(), 1); assert.equal(m.charges.length, 0); assert.equal(m.rec.length, 0); assert.equal(s.errors, 1);
});
test("故障再現 lose_response: Stripeへは送信済みだが応答を受け取らず停止 → 記録なし", async () => {
  const m = mk(); await runHireFeeCharges({ db: m.db, stripe: m.stripe, ...LIVE, fault: "lose_response" });
  assert.equal(m.charges.length, 1); assert.equal(m.rec.length, 0);
});
test("故障再現 fail_record: Stripeは完了したが結果の記録に失敗 → 記録なし", async () => {
  const m = mk(); await runHireFeeCharges({ db: m.db, stripe: m.stripe, ...LIVE, fault: "fail_record" });
  assert.equal(m.charges.length, 1); assert.equal(m.rec.length, 0);
});
test("故障再現は本番鍵・本番環境では無効", () => {
  assert.equal(faultFromEnv({ HIRE_CHARGE_TEST_FAULT: "lose_response" } as never, false), "lose_response");
  assert.equal(faultFromEnv({ HIRE_CHARGE_TEST_FAULT: "lose_response" } as never, true), undefined);
  assert.equal(faultFromEnv({ HIRE_CHARGE_TEST_FAULT: "lose_response", VERCEL_ENV: "production" } as never, false), undefined);
  assert.equal(faultFromEnv({ HIRE_CHARGE_TEST_FAULT: "bogus" } as never, false), undefined);
  assert.equal(faultFromEnv({} as never, false), undefined);
});
// ---- 復旧
test("復旧(送信前に停止): Stripeに決済が無ければ、同じ試行・同じ冪等キーで送信し、結果を記録（新しい試行は作らない）", async () => {
  const m = mk({ recoverable: [rcv()], found: null });
  const s = await runHireFeeRecovery({ db: m.db, stripe: m.stripe, ...LIVE });
  assert.equal(s.resent, 1); assert.equal(m.charges.length, 1); assert.equal(m.charges[0].idempotencyKey, "hirefee:s1:1"); assert.equal(m.charges[0].metadata.hire_fee_attempt_id, "at1");
  assert.deepEqual(m.rec, [["at1", "succeeded", "pi_1"]]);
});
test("復旧(送信後に応答が消失): Stripeに決済があれば再送せず、その結果を照合して反映", async () => {
  const m = mk({ recoverable: [rcv({ sent_at: "t" })], found: intent() });
  const s = await runHireFeeRecovery({ db: m.db, stripe: m.stripe, ...LIVE });
  assert.equal(m.charges.length, 0); assert.equal(s.applied, 1); assert.equal(m.rec.length, 0);
  assert.deepEqual(m.applied[0], { ...intent(), attemptId: "at1", result: "succeeded", eventId: "lookup:at1:pi_1", source: "stripe_lookup" });
});
test("復旧(結果の記録に失敗): 失敗した決済も照合して反映（再送しない）", async () => {
  const m = mk({ recoverable: [rcv({ sent_at: "t" })], found: intent({ status: "requires_payment_method" }) });
  await runHireFeeRecovery({ db: m.db, stripe: m.stripe, ...LIVE });
  assert.equal(m.charges.length, 0); assert.equal((m.applied[0] as { result: string }).result, "failed");
});
test("復旧: 決済が処理中なら再送せず『結果不明』にして確定の通知を待つ（結果不明の試行はそのまま残す）", async () => {
  const m = mk({ recoverable: [rcv({ sent_at: "t" })], found: intent({ status: "processing" }) });
  const s = await runHireFeeRecovery({ db: m.db, stripe: m.stripe, ...LIVE });
  assert.equal(m.charges.length, 0); assert.equal(s.markedUnknown, 1); assert.deepEqual(m.rec, [["at1", "unknown", "pi_1"]]);
  const m2 = mk({ recoverable: [rcv({ status: "unknown", external_ref: "pi_1" })], found: intent({ status: "processing" }) });
  const s2 = await runHireFeeRecovery({ db: m2.db, stripe: m2.stripe, ...LIVE });
  assert.equal(s2.left, 1); assert.equal(m2.rec.length, 0);
});
test("復旧: 冪等キーの保持期間が近い／過ぎた試行は再送せず『結果不明』にして運営の確認へ（新しい試行は作らない）", async () => {
  const m = mk({ recoverable: [rcv({ age_minutes: IDEMPOTENCY_SAFE_MINUTES })], found: null });
  const s = await runHireFeeRecovery({ db: m.db, stripe: m.stripe, ...LIVE });
  assert.equal(m.charges.length, 0); assert.equal(s.markedUnknown, 1); assert.deepEqual(m.rec, [["at1", "unknown", null]]);
});
test("復旧: 結果不明の試行は、Stripeに決済が無ければ再送せず残す（確認されるまで新しい試行は作られない）", async () => {
  const m = mk({ recoverable: [rcv({ status: "unknown" })], found: null });
  const s = await runHireFeeRecovery({ db: m.db, stripe: m.stripe, ...LIVE });
  assert.equal(m.charges.length, 0); assert.equal(m.rec.length, 0); assert.equal(s.left, 1);
});
test("復旧: 結果不明の試行をStripe照合で確定できる（金額・顧客などの照合はDB側。不一致ならDBが記録して残す）", async () => {
  const m = mk({ recoverable: [rcv({ status: "unknown", external_ref: "pi_1" })], found: intent() });
  await runHireFeeRecovery({ db: m.db, stripe: m.stripe, ...LIVE });
  assert.equal((m.applied[0] as { source: string }).source, "stripe_lookup");
  const m2 = mk({ recoverable: [rcv({ status: "unknown" })], found: intent({ amount: 1 }), applyResult: "mismatch" });
  const s2 = await runHireFeeRecovery({ db: m2.db, stripe: m2.stripe, ...LIVE });
  assert.equal(s2.left, 1); assert.equal(s2.applied, 0);
});
test("復旧: 冪等キーが試行と食い違う・モード違い・送信の印を付けられない場合は再送しない", async () => {
  for (const [i, marked] of [[info({ idempotency_key: "other" }), true], [info({ livemode: true }), true], [info(), false]] as [ChargeInfo, boolean][]) {
    const m = mk({ recoverable: [rcv()], found: null, info: i, marked }); const s = await runHireFeeRecovery({ db: m.db, stripe: m.stripe, ...LIVE });
    assert.equal(m.charges.length, 0); assert.equal(s.resent, 0);
  }
});
test("復旧: 1件の例外で他を止めない・Stripe照合が失敗しても再送しない", async () => {
  const m = mk({ recoverable: [rcv(), rcv({ attempt_id: "at2" })] }); let n = 0; m.stripe.findByAttempt = async () => { if (n++ === 0) throw new Error("search down"); return null; };
  const s = await runHireFeeRecovery({ db: m.db, stripe: m.stripe, ...LIVE });
  assert.equal(s.errors, 1); assert.equal(s.resent, 1); assert.equal(m.charges.length, 1);
});
// ---- webhook
const calls: [string, unknown][] = [];
const deps = (ret: string): HandlerDeps => ({ callRpc: (async (fn: string, a: unknown) => { calls.push([fn, a]); return ret; }) as never, stripe: {} as never, now: () => new Date(), expectedLivemode: false });
const pio = (md: Record<string, string> | undefined) => ({ id: "pi_1", metadata: md, amount: 605000, currency: "jpy", customer: "cus_1", livemode: false });
const ev = (type: string, md: Record<string, string> | undefined, live = false) => ({ id: "evt_1", type, livemode: live, created: 1, data: { object: pio(md) } }) as unknown as Stripe.Event;
test("webhook: 採用料の試行IDつきの決済結果通知を、請求の内容と照合できる項目つきで反映する（成功/失敗）", async () => {
  assert.ok((HANDLED_EVENT_TYPES as readonly string[]).includes("payment_intent.succeeded") && (HANDLED_EVENT_TYPES as readonly string[]).includes("payment_intent.payment_failed"));
  calls.length = 0;
  assert.equal((await processStripeEvent(ev("payment_intent.succeeded", { hire_fee_attempt_id: "at1", hire_fee_schedule_id: "s1" }), deps("applied"))).result, "processed");
  assert.deepEqual(calls[0], ["service_hire_fee_apply_notification", { p_attempt_id: "at1", p_result: "succeeded", p_payment_intent_id: "pi_1", p_event_id: "evt_1", p_amount: 605000, p_currency: "jpy", p_customer_id: "cus_1", p_livemode: false, p_schedule_id: "s1", p_source: "stripe_webhook" }]);
  await processStripeEvent(ev("payment_intent.payment_failed", { hire_fee_attempt_id: "at1", hire_fee_schedule_id: "s1" }), deps("applied"));
  assert.equal((calls[1][1] as { p_result: string }).p_result, "failed");
});
test("webhook: 試行IDが無い決済・モード違いは反映しない。不一致(mismatch)・食い違い(conflict)は『確認が必要』として扱う", async () => {
  calls.length = 0;
  assert.equal((await processStripeEvent(ev("payment_intent.succeeded", {}), deps("applied"))).note, "not_hire_fee");
  assert.equal(calls.length, 0);
  assert.equal((await processStripeEvent(ev("payment_intent.succeeded", { hire_fee_attempt_id: "at1" }, true), deps("applied"))).note, "livemode_mismatch");
  assert.equal(calls.length, 0);
  for (const r of ["mismatch", "conflict"]) { const o = await processStripeEvent(ev("payment_intent.succeeded", { hire_fee_attempt_id: "at1", hire_fee_schedule_id: "s1" }), deps(r)); assert.equal(o.result, "integrity_issue"); assert.equal(o.note, `hire_fee_${r}`); }
  assert.equal((await processStripeEvent(ev("payment_intent.succeeded", { hire_fee_attempt_id: "at1", hire_fee_schedule_id: "s1" }), deps("repeated"))).result, "processed");
});

// ===== 請求停止中の動作（実装・PC手順・試験で一致）: 照合だけは行い、決済を発生させる送信（再送・新しい請求）はしない =====
test("請求停止中の復旧(照合だけ): Stripeに決済が無い進行中の試行は、再送せず残す（送信の印も付けない・Stripeへ請求もしない）", async () => {
  const m = mk({ recoverable: [rcv()], found: null });
  const s = await runHireFeeRecovery({ db: m.db, stripe: m.stripe, ...LOOKUP_ONLY });
  assert.equal(s.held, 1); assert.equal(s.resent, 0); assert.equal(m.charges.length, 0); assert.equal(m.marks(), 0); assert.deepEqual(m.rec, []);
});
test("請求停止中の復旧(照合だけ): Stripeに決済があれば、結果の反映は行う（決済は発生しない）", async () => {
  const m = mk({ recoverable: [rcv({ sent_at: "t" })], found: intent() });
  const s = await runHireFeeRecovery({ db: m.db, stripe: m.stripe, ...LOOKUP_ONLY });
  assert.equal(s.applied, 1); assert.equal(m.applied.length, 1); assert.equal(m.charges.length, 0);
});
test("請求停止中でも、冪等キーの期限を過ぎた試行は『結果不明』にする（記録だけ・決済は発生しない）", async () => {
  const m = mk({ recoverable: [rcv({ age_minutes: IDEMPOTENCY_SAFE_MINUTES })], found: null });
  const s = await runHireFeeRecovery({ db: m.db, stripe: m.stripe, ...LOOKUP_ONLY });
  assert.equal(s.markedUnknown, 1); assert.deepEqual(m.rec, [["at1", "unknown", null]]); assert.equal(m.charges.length, 0);
});
test("ジョブ: 請求停止中は、期日の一覧を取らず・請求せず、復旧は照合だけ", async () => {
  const m = mk({ enabled: false, recoverable: [rcv()], found: null });
  const r = await runHireFeeJob({ db: m.db, stripe: m.stripe, expectedLivemode: false });
  assert.equal(r.billingEnabled, false); assert.equal(r.charges, null); assert.equal(m.dueCalls.length, 0); assert.equal(m.charges.length, 0); assert.equal(r.recovery.held, 1); assert.equal(r.recovery.resent, 0);
});
test("ジョブ: 設定を読めないときは請求停止として扱う（決済を発生させない）", async () => {
  const m = mk({ enabled: "throw", recoverable: [rcv()], found: null });
  const r = await runHireFeeJob({ db: m.db, stripe: m.stripe, expectedLivemode: false });
  assert.equal(r.billingEnabled, false); assert.equal(r.charges, null); assert.equal(m.charges.length, 0);
});
test("ジョブ: 請求が有効なら、復旧の再送も新しい請求も行う（再開後に、停止中に残した試行が送られる）", async () => {
  const m = mk({ enabled: true, recoverable: [rcv()], found: null });
  const r = await runHireFeeJob({ db: m.db, stripe: m.stripe, expectedLivemode: false });
  assert.equal(r.billingEnabled, true); assert.equal(r.recovery.resent, 1); assert.ok(r.charges && r.charges.due === 1); assert.equal(m.charges.length, 2);
});
