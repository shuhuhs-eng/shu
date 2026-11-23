// 外部入力の配列を要素検証の前に打ち切る防御(zod GHSA-mrhx-c7xc-m3w5 の緩和)の回帰試験。
// 確認すること: ①巨大・不正な配列は1件の不正で即時に拒否される(要素ごとの報告が溜まらない) ②上限内の入力は従来と同じ結果
// ③実際の入口(通知の既読化・希望条件の保存・プロフィール保存)が、巨大入力で保存処理(RPC)へ進まない ④正規の入力は従来どおり通る。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { z } from "zod";
import { capArrayInput } from "../lib/validation/bounded-array";
import { profileFormSchema, profileFormSchemaSpecialtiesOptional } from "../lib/validation/profile";
import { salonProfileFormSchema } from "../lib/validation/salon-profile";
import { salonStoreProfileFormSchema } from "../lib/validation/salon-store-profile";
import { salonCultureStepSchema, salonCultureCompletedSchema } from "../lib/validation/salon-culture";

const BIG = 200_000;
const bad = (n: number) => Array.from({ length: n }, () => ({ type: 1, id: "x" }));
const countFor = (r: { success: boolean; error?: z.ZodError }, key: string) => (r.error?.issues ?? []).filter((i) => i.path[0] === key).length;

test("[helper] 上限超過は要素に触れず1件で拒否・上限内は従来どおり", () => {
  const item = z.object({ a: z.string() });
  const plain = z.array(item).max(3);
  const capped = capArrayInput(3, plain);
  const hugeBad = Array.from({ length: BIG }, () => ({ a: 1 }));
  const pr = plain.safeParse(hugeBad); // 従来: 要素ごとの報告が溜まる(これが問題)
  assert.ok(!pr.success && pr.error.issues.length >= BIG, "前提: 従来の z.array().max() は全要素を検証して報告を溜める");
  const t0 = Date.now(); const r = capped.safeParse(hugeBad); const ms = Date.now() - t0;
  assert.ok(!r.success && r.error.issues.length === 1, "上限超過は1件");
  assert.ok(ms < 200, `即時に拒否される(${ms}ms)`);
  assert.equal(capped.safeParse([{ a: "x" }, { a: "y" }, { a: "z" }]).success, true, "上限ちょうどは通る");
  assert.equal(capped.safeParse([{ a: "x" }, { a: "y" }, { a: "z" }, { a: "w" }]).success, false, "上限+1は拒否");
  assert.equal(capped.safeParse("x").success, false); assert.equal(capped.safeParse(null).success, false); assert.equal(capped.safeParse(undefined).success, false);
  const inner = capped.safeParse([{ a: 1 }, { a: "ok" }]); // 上限内の不正要素は従来どおり要素の報告(パス・メッセージ)が出る
  assert.ok(!inner.success && inner.error.issues.length === 1 && inner.error.issues[0].path.join(".") === "0.a");
  assert.deepEqual(capped.parse([{ a: "x" }]), [{ a: "x" }], "出力は従来と同じ");
});

test("[schema] 実際のスキーマ: 巨大入力は当該項目1件で拒否・順序や重複の既存規則は維持", () => {
  const huge = Array.from({ length: BIG }, () => "zzz");
  for (const [name, s, key] of [["profile.specialties", profileFormSchema, "specialties"], ["profile.valuePriorities", profileFormSchema, "valuePriorities"], ["profile(任意).specialties", profileFormSchemaSpecialtiesOptional, "specialties"],
    ["salon.targetSpecialties", salonProfileFormSchema, "targetSpecialties"], ["store.targetSpecialties", salonStoreProfileFormSchema, "targetSpecialties"]] as const) {
    const t0 = Date.now(); const r = (s as z.ZodTypeAny).safeParse({ [key]: huge }) as { success: boolean; error?: z.ZodError };
    assert.equal(countFor(r, key), 1, `${name}: 巨大入力は1件`); assert.ok(Date.now() - t0 < 500, `${name}: 即時`);
  }
  const step = salonCultureStepSchema.safeParse({ status: "draft", respondentRole: null, currentStep: 0, answers: {}, valuePriorities: huge, comment: "" });
  assert.equal(countFor(step as never, "valuePriorities"), 1);
  const done = salonCultureCompletedSchema.safeParse({ valuePriorities: huge }); assert.equal(countFor(done as never, "valuePriorities"), 1);
  // 既存の規則: 件数・重複の文言は変わらない
  const dup = profileFormSchema.safeParse({ valuePriorities: ["work_life_balance", "work_life_balance", "skill_growth"] });
  assert.ok(!dup.success && dup.error.issues.some((i) => i.path[0] === "valuePriorities" && i.message === "同じ項目を重複して選択できません"));
  const two = profileFormSchema.safeParse({ valuePriorities: ["work_life_balance", "skill_growth"] });
  assert.ok(!two.success && two.error.issues.some((i) => i.path[0] === "valuePriorities" && i.message === "重要な項目を3つ選択してください"));
  const none = profileFormSchema.safeParse({ specialties: [] });
  assert.ok(!none.success && none.error.issues.some((i) => i.path[0] === "specialties" && i.message.length > 0));
  assert.equal(profileFormSchemaSpecialtiesOptional.safeParse({ specialties: [] }).error?.issues.some((i) => i.path[0] === "specialties") ?? false, false, "任意版は0件を許す(従来どおり)");
});

// ---- 入口(サーバーアクション): 巨大入力で保存処理へ進まない ----
const calls: string[] = []; let created = 0;
const fake = { auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) }, rpc: async (name: string) => { calls.push(name); return { data: 1, error: null }; },
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: "u1", avatar_path: null }, error: null }), maybeSingle: async () => ({ data: null, error: null }) }) }) }), storage: { from: () => ({ remove: async () => ({ error: null }) }) } };
const originalLoad = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/cache") return { revalidatePath: () => undefined };
  if (request === "@/lib/supabase/server") return { createClient: async () => { created++; return fake; } };
  return originalLoad.call(this, request, ...rest);
};
after(() => { (Module as unknown as { _load: unknown })._load = originalLoad; });
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { markNotificationsReadForEntities } = require("../lib/notifications/actions");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { saveStylistMatchProfile } = require("../lib/match-profile/actions");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { saveProfileAction } = require("../lib/profile/actions");
const UUID = "3f2c1a9e-5b7d-4c1e-9a2b-0d3e4f5a6b7c";

test("[入口] 通知の既読化: 巨大・不正な配列は保存処理へ進まず即時に失敗・上限内は従来どおり", async () => {
  calls.length = 0; created = 0;
  const t0 = Date.now(); const r = await markNotificationsReadForEntities(bad(BIG)); const ms = Date.now() - t0;
  assert.equal(r.success, false); assert.ok(ms < 300, `${ms}ms`); assert.equal(created, 0, "クライアント生成(認証・DB)へ進まない"); assert.deepEqual(calls, []);
  const over = await markNotificationsReadForEntities(Array.from({ length: 201 }, () => ({ type: "salon", id: UUID }))); assert.equal(over.success, false); assert.deepEqual(calls, []);
  const ok200 = await markNotificationsReadForEntities(Array.from({ length: 200 }, () => ({ type: "salon", id: UUID }))); assert.equal(ok200.success, true); assert.deepEqual(calls, ["mark_notifications_read_by_entities"]);
  calls.length = 0; assert.equal((await markNotificationsReadForEntities([])).success, false, "0件は従来どおり拒否");
  assert.equal((await markNotificationsReadForEntities([{ type: "salon", id: UUID }])).success, true, "1件は通る");
});

test("[入口] 希望条件の保存: 巨大な secondaryGoals は保存処理へ進まない", async () => {
  calls.length = 0; created = 0;
  const base = { primaryGoal: "x", careerStage: "growing_stylist", wantsPerformanceOffer: false, evidencePeriodMonths: null, avgMonthlyTechnicalSales: null, avgMonthlyRetailSales: null, avgMonthlyClients: null, avgMonthlyNamedClients: null, averageTicket: null, repeatRate: null, monthlyWorkingDays: null, averageDailyHours: null, selfAcquiredClients: null, expectedTransferClients: null, assistantUsage: null };
  const t0 = Date.now(); const r = await saveStylistMatchProfile({ ...base, secondaryGoals: Array.from({ length: BIG }, () => "nope") });
  assert.equal(r.success, false); assert.ok(Date.now() - t0 < 300); assert.equal(created, 0); assert.deepEqual(calls, []);
});

test("[入口] プロフィール保存: 巨大な specialties / valuePriorities は保存処理へ進まず、正規の入力は従来どおり保存される", async () => {
  const mk = (extra: Record<string, string[]> = {}) => { const f = new FormData(); const b: Record<string, string[]> = { publicName: ["さくら"], prefecture: ["東京都"], experienceYears: ["3"], specialties: ["カット"], employmentType: ["full_time"], jobChangeIntent: ["passive"], fullName: ["山田 花子"], ageBand: ["30_34"], gender: ["female"], birthDate: ["1990-04-01"], ageDisplayMode: ["decade"], valuePriorities: ["work_life_balance", "skill_growth", "income_stability"], visibility: ["PUBLIC"], desiredWorkLocation: [""], currentPosition: [""], bio: [""], avatarPath: [""], careerPhase: ["experienced"], ...extra }; for (const [k, v] of Object.entries(b)) for (const x of v) f.append(k, x); return f; };
  calls.length = 0; created = 0;
  const huge = Array.from({ length: BIG }, () => "zzz");
  for (const extra of [{ specialties: huge }, { valuePriorities: huge }] as Record<string, string[]>[]) {
    const t0 = Date.now(); const r = await saveProfileAction({}, mk(extra)); assert.ok(r.error, "拒否される"); assert.ok(Date.now() - t0 < 500); assert.deepEqual(calls, [], "保存RPCへ進まない");
  }
  const good = await saveProfileAction({}, mk()); assert.ok(!good.error, JSON.stringify(good)); assert.ok(calls.some((c) => c.startsWith("save_stylist_profile")), "正規の入力は保存まで進む");
});
