import test, { after } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { CARD_REQUIRED_MESSAGE, CARD_UNKNOWN_MESSAGE, cardGateErrorMessage, cardRequiredPath, decideCardGate, getSalonCardGate, isCardGatedPath, salonCardBlockMessage } from "../lib/billing/salon-card-gate";

const rows = (...r: [boolean, boolean][]) => r.map(([card_ready, can_register], i) => ({ organization_id: `o${i}`, card_ready, can_register, required: true }));
const client = (res: { data: unknown; error: unknown } | "throw") => ({ rpc: async (fn: string) => { assert.equal(fn, "get_my_salon_card_state"); if (res === "throw") throw new Error("x"); return res; } });

test("対象パス: サロン業務は対象。登録・更新（billing）・請求先・契約・ログイン・案内・公開ページは対象外", () => {
  for (const p of ["/salon/mypage", "/salon/company", "/salon/company/hiring", "/salon/company/analytics", "/salon/stores/abc/candidates", "/salon/profile", "/salon-culture", "/diagnosis/salon", "/messages", "/messages/123"]) assert.equal(isCardGatedPath(p), true, p);
  for (const p of ["/salon", "/salon/login", "/salon/card-required", "/salon/company/billing", "/salon/company/billing-profile", "/salon/company/contract", "/stylist/mypage", "/", "/legal/accept", "/api/stripe/webhook", "/salon/company/billingx"]) assert.equal(isCardGatedPath(p), p === "/salon/company/billingx", p);
});
test("判定: 全社登録済みは通す／1社でも未登録なら止める／所属なしは対象外／取得失敗は止める(fail-closed)", () => {
  assert.deepEqual(decideCardGate(rows([true, true])), { blocked: false, canRegister: false, unknown: false });
  assert.deepEqual(decideCardGate(rows([true, true], [false, true])), { blocked: true, canRegister: true, unknown: false });
  assert.deepEqual(decideCardGate(rows([false, false])), { blocked: true, canRegister: false, unknown: false });
  assert.deepEqual(decideCardGate([]), { blocked: false, canRegister: false, unknown: false });
  assert.deepEqual(decideCardGate(rows([false, true]).map((r) => ({ ...r, required: false }))), { blocked: false, canRegister: false, unknown: false }, "DBの設定が無効なら、未登録でも止めない");
  assert.deepEqual(decideCardGate(null), { blocked: true, canRegister: false, unknown: true });
});
test("移動先: 登録できる人は登録画面（案内つき）、それ以外は案内画面", () => {
  assert.equal(cardRequiredPath({ blocked: true, canRegister: true, unknown: false }), "/salon/company/billing?card=required");
  assert.equal(cardRequiredPath({ blocked: true, canRegister: false, unknown: false }), "/salon/card-required");
});
test("RPCの取得: エラー・例外・配列でない応答はすべて fail-closed。関数が無い(0109未適用)ときだけ対象外", async () => {
  for (const r of [{ data: null, error: { message: "x" } }, { data: {}, error: null }, "throw" as const]) assert.equal((await getSalonCardGate(client(r))).blocked, true);
  assert.equal((await getSalonCardGate(client({ data: rows([true, true]), error: null }))).blocked, false);
  for (const code of ["PGRST202", "42883"]) assert.equal((await getSalonCardGate(client({ data: null, error: { code, message: "no function" } }))).blocked, false, code);
});
test("DBの拒否文言: カード必須の拒否だけ案内文にそろえる", () => {
  assert.equal(cardGateErrorMessage("card registration required"), CARD_REQUIRED_MESSAGE);
  assert.equal(cardGateErrorMessage("store write permission required"), null); assert.equal(cardGateErrorMessage(null), null);
});
test("server action 用の判定: 未登録・確認不能は拒否文／登録済み・無効は通す", async () => {
  assert.equal(await salonCardBlockMessage(client({ data: rows([false, true]), error: null })), CARD_REQUIRED_MESSAGE);
  assert.equal(await salonCardBlockMessage(client("throw")), CARD_UNKNOWN_MESSAGE);   // 確認できない: 登録未完了とは別の文言（操作は行わない）
  assert.equal(await salonCardBlockMessage(client({ data: rows([true, true]), error: null })), null);
  assert.equal(await salonCardBlockMessage(client({ data: rows([false, true]).map((r) => ({ ...r, required: false })), error: null })), null);
});

// ===== 実際の server action を動かす試験（文字列の個数ではなく、振る舞い）: 未登録なら操作が拒否され、登録済みなら成功する =====
type Call = { name: string; args: Record<string, unknown> };
const env: { required: boolean; registered: boolean; stateFails: boolean; staleState: boolean; noCompany: boolean; calls: Call[] } = { required: true, registered: false, stateFails: false, staleState: false, noCompany: false, calls: [] };
const fake = {
  auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }), maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name === "get_my_salon_card_state") {
      if (env.stateFails) return { data: null, error: { message: "boom" } };
      // staleState: 判定用の応答は『必須ではない』と返すが、DBの書き込みは拒否する（判定の取得と書き込みの間に設定が変わった場合）
      if (env.noCompany) return { data: [], error: null };   // 会社が未作成（所属なし）
      return { data: [{ organization_id: "o1", card_ready: env.registered, can_register: true, required: env.staleState ? false : env.required }], error: null };
    }
    env.calls.push({ name, args });
    // DB側の強制（トリガー）の再現: 必須かつ未登録なら、書き込みRPCは拒否される
    if (env.required && !env.registered && !env.noCompany) return { data: null, error: { code: "P0001", message: "card registration required" } };
    return { data: { status: "pending" }, error: null };
  },
};
const orig = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/cache") return { revalidatePath: () => undefined };
  if (request === "@/lib/supabase/server") return { createClient: async () => fake };
  return orig.call(this, request, ...rest);
};
after(() => { (Module as unknown as { _load: unknown })._load = orig; });
process.env.HIRE_BILLING_ENABLED = "1"; process.env.SALARY_OFFER_PRESENTATION_PAUSED = "false";   // 条件提示は別の一時停止スイッチ（既定で停止中）があるため、この試験では解除して確認する
/* eslint-disable @typescript-eslint/no-require-imports */
const { sendStoreScout } = require("../lib/scouts/actions");
const { createStoreSalaryOffer } = require("../lib/salary-offers/actions");
const { salonConfirmOffer } = require("../lib/billing/hire-actions");
const { requestAgeDisclosure } = require("../lib/age-disclosure/actions");
const { addHiringCandidateAction } = require("../lib/hiring/actions");
const { saveSalonProfileAction } = require("../lib/salon/actions");
/* eslint-enable @typescript-eslint/no-require-imports */
const U1 = "11111111-1111-4111-8111-111111111111", U2 = "22222222-2222-4222-8222-222222222222";
const ACTIONS: { label: string; rpc: string; run: () => Promise<{ success: boolean; error?: string }> }[] = [
  { label: "スカウト送信 sendStoreScout", rpc: "send_scout_v2", run: () => sendStoreScout({ storeId: U1, stylistUserId: U2, message: "はじめまして", templateType: null }) },
  { label: "条件提示 createStoreSalaryOffer", rpc: "create_salary_offer_v2", run: () => createStoreSalaryOffer({ storeId: U1, stylistUserId: U2, monthlyGuarantee: 300000, performanceAddition: 0, performanceCondition: null, guaranteeMonths: 6, message: null }) },
  { label: "入社内容の確定 salonConfirmOffer", rpc: "company_hire_confirm_offer", run: () => salonConfirmOffer({ agreementId: U1, expectedRevision: 1, startDate: "2027-03-10", feeRole: "stylist", totalAmount: 605000 }) },
  { label: "年齢開示の依頼 requestAgeDisclosure", rpc: "request_stylist_age_disclosure", run: () => requestAgeDisclosure({ storeId: U1, stylistUserId: U2 }) },
  { label: "候補者の追加 addHiringCandidateAction", rpc: "add_hiring_candidate", run: () => addHiringCandidateAction(U1, U2) },
];
const reset = (o: Partial<typeof env>) => Object.assign(env, { required: true, registered: false, stateFails: false, staleState: false, noCompany: false, calls: [] }, o);

for (const a of ACTIONS) {
  test(`${a.label}: 未登録(必須)なら拒否され、書き込みRPCは呼ばれない`, async () => {
    reset({ registered: false }); const r = await a.run();
    assert.equal(r.success, false); assert.equal(r.error, CARD_REQUIRED_MESSAGE); assert.deepEqual(env.calls, []);
  });
  test(`${a.label}: 登録済みなら書き込みRPCが1回呼ばれて成功する`, async () => {
    reset({ registered: true }); const r = await a.run();
    assert.equal(r.success, true, JSON.stringify(r)); assert.deepEqual(env.calls.map((c) => c.name), [a.rpc]);
  });
  test(`${a.label}: カード状態を確認できないときは、止める(fail-closed)・書き込みRPCは呼ばれない`, async () => {
    reset({ stateFails: true, registered: true }); const r = await a.run();
    assert.equal(r.success, false); assert.equal(r.error, CARD_UNKNOWN_MESSAGE); assert.deepEqual(env.calls, []);
  });
  test(`${a.label}: 判定の後にDBが拒否した場合も、同じ案内文になる（成功にしない）`, async () => {
    reset({ registered: false, staleState: true }); const r = await a.run();
    assert.equal(r.success, false); assert.equal(r.error, CARD_REQUIRED_MESSAGE); assert.deepEqual(env.calls.map((c) => c.name), [a.rpc]);
  });
  test(`${a.label}: DBの設定が無効なら、未登録でも通常どおり動く`, async () => {
    reset({ required: false, registered: false }); const r = await a.run();
    assert.equal(r.success, true, JSON.stringify(r)); assert.deepEqual(env.calls.map((c) => c.name), [a.rpc]);
  });
}
test("画面側: middleware が判定を呼び、案内画面は DBの設定で動く（環境変数では切り替えない）", () => {
  const mw = readFileSync("lib/supabase/middleware.ts", "utf8");
  assert.ok(mw.includes("isCardGatedPath(pathname)") && mw.includes("cardRequiredPath(gate)") && !mw.includes("SALON_CARD_REQUIRED"));
  const page = readFileSync("app/salon/card-required/page.tsx", "utf8"); assert.ok(page.includes("getSalonCardGate") && !page.includes("SALON_CARD_REQUIRED"));
});

// 初回のサロン登録: 会社が未作成（所属なし）なら、カード必須ONでも初回保存は通り、保存RPC（save_salon_profile）が1回呼ばれる。会社ができた後の再保存は、未登録なら止まる。
const salonForm = () => { const f = new FormData(); f.set("salonName", "初回サロン"); f.set("prefecture", "東京都"); f.set("visibility", "PRIVATE"); for (const k of ["city", "streetAddress", "cultureDescription", "employeeSizeCode", "instagramHandle", "bio", "avatarPath", "hotpepperUrl"]) f.set(k, ""); f.append("targetSpecialties", "カット"); return f; };
test("初回のサロン登録（会社未作成）: カード必須ONでも初回保存RPCが呼ばれて完了する", async () => {
  reset({ noCompany: true }); const r = await saveSalonProfileAction({}, salonForm());
  assert.ok(r.success, JSON.stringify(r)); assert.deepEqual(env.calls.map((c) => c.name), ["save_salon_profile"]);
});
test("会社の作成後の再保存: カード未登録なら案内文で止まり、保存RPCは呼ばれない／登録済みなら保存できる", async () => {
  reset({ registered: false }); const r = await saveSalonProfileAction({}, salonForm());
  assert.equal(r.error, CARD_REQUIRED_MESSAGE); assert.deepEqual(env.calls, []);
  reset({ registered: true }); const r2 = await saveSalonProfileAction({}, salonForm());
  assert.ok(r2.success, JSON.stringify(r2)); assert.deepEqual((env.calls as Call[]).map((c) => c.name), ["save_salon_profile"]);
});
