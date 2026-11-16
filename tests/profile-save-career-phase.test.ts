// saveProfileAction の「いまの立場（必須・3択）」: サーバー側でも必須。保存は save_stylist_profile_v3 の1回だけ（別々に保存しない）。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

type Call = { name: string; args: Record<string, unknown> };
type Phase = "ok-null" | "ok-student" | "ok-experienced" | "unsupported" | "error";
const env: { phase: Phase; rpcError: { message: string } | null; calls: Call[] } = { phase: "ok-null", rpcError: null, calls: [] };

function fakeSupabase() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: () => ({
          single: async () => ({ data: { id: "u1", avatar_path: null }, error: null }),
          maybeSingle: async () => {
            if (table === "stylist_profiles" && cols.includes("career_phase")) {
              if (env.phase === "unsupported") return { data: null, error: { code: "42703", message: "column stylist_profiles.career_phase does not exist" } };
              if (env.phase === "error") return { data: null, error: { code: "XX000", message: "boom" } };
              const cp = env.phase === "ok-student" ? "student" : env.phase === "ok-experienced" ? "experienced" : null;
              return { data: { career_phase: cp, graduation_ym: cp === "student" ? "2027-03-01" : null, blank_period_value: null, blank_period_unit: null }, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => { env.calls.push({ name, args }); return { data: null, error: env.rpcError }; },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  };
}
const originalLoad = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/cache") return { revalidatePath: () => undefined };
  if (request === "@/lib/supabase/server") return { createClient: async () => fakeSupabase() };
  return originalLoad.call(this, request, ...rest);
};
after(() => { (Module as unknown as { _load: unknown })._load = originalLoad; });
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { saveProfileAction } = require("../lib/profile/actions");

import { graduationYearOptions as gyo, isAllowedGraduationYm as isOk } from "../lib/student-diagnosis/career-phase";
// 実行時点で選べる、最初の「卒業（予定）年・月（3月/10月）」
const GRAD = (() => { for (const y of gyo()) for (const m of [3, 10]) if (isOk(`${y}-${String(m).padStart(2, "0")}`)) return { y, m }; throw new Error("no grad"); })();
const ymOffset = (d: number) => { const n = new Date(); const i = n.getFullYear() * 12 + n.getMonth() + d; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`; };
function form(extra: Record<string, string | string[]> = {}, drop: string[] = []): FormData {
  const f = new FormData();
  const base: Record<string, string | string[]> = {
    publicName: "さくら", prefecture: "東京都", experienceYears: "3", specialties: ["カット"], employmentType: "full_time",
    jobChangeIntent: "passive", fullName: "山田 花子", ageBand: "30_34", gender: "female", birthDate: "1990-04-01", ageDisplayMode: "decade",
    valuePriorities: ["work_life_balance", "skill_growth", "income_stability"], visibility: "PUBLIC",
    desiredWorkLocation: "", currentPosition: "", bio: "", avatarPath: "", ...extra,
  };
  for (const k of drop) delete base[k];
  for (const [k, v] of Object.entries(base)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
const run = async (f: FormData, phase: Phase = "ok-null", rpcError: { message: string } | null = null) => {
  env.phase = phase; env.rpcError = rpcError; env.calls = [];
  return saveProfileAction({}, f) as Promise<{ error?: string; success?: string; fieldErrors?: Record<string, string[]> }>;
};

test("必須: 立場が未選択なら、何も保存せずエラー（どのRPCも呼ばない）。旧データ（未設定・美容学生）でも同じ", async () => {
  for (const ph of ["ok-null", "ok-student", "ok-experienced"] as const) {
    const r = await run(form({}, ["careerPhase"]), ph);
    assert.ok(r.error && r.fieldErrors?.careerPhase?.[0], ph);
    assert.equal(env.calls.length, 0, `${ph}: 保存されない`);
    const r2 = await run(form({ careerPhase: "" }), ph);
    assert.ok(r2.fieldErrors?.careerPhase && env.calls.length === 0);
  }
});

test("必須: 旧値 student や不明な値は受け付けない（3択のみ）", async () => {
  for (const bad of ["student", "bogus", "BLANK", "選ばない"]) {
    const r = await run(form({ careerPhase: bad, graduationYear: String(GRAD.y), graduationMonth: String(GRAD.m) }));
    assert.ok(r.fieldErrors?.careerPhase, bad);
    assert.equal(env.calls.length, 0);
  }
});

test("保存: 3択それぞれが v4 の1回で保存される（プロフィールと立場を別々に呼ばない・v3・旧関数は呼ばない）。旧3項目は送らない", async () => {
  for (const ph of ["experienced", "blank"] as const) {
    const r = await run(form({ careerPhase: ph }));
    assert.equal(r.success, "プロフィールを保存しました。");
    assert.deepEqual(env.calls.map((c) => c.name), ["save_stylist_profile_v4"]);
    const a = env.calls[0].args;
    assert.equal(a.p_career_phase, ph);
    assert.deepEqual([a.p_graduation_ym, a.p_blank_period_value, a.p_blank_period_unit], [null, null, null], "ブランク期間は未入力のままNULL（0ヶ月にしない）");
    assert.equal(a.p_birth_date, "1990-04-01");
    for (const k of ["p_graduation_kind", "p_desired_start_ym", "p_license_status"]) assert.ok(!(k in a), `${k} は送らない（補わない）`);
  }
  const r = await run(form({ careerPhase: "new_graduate", graduationYear: String(GRAD.y), graduationMonth: String(GRAD.m) }), "ok-student");
  assert.equal(r.success, "プロフィールを保存しました。");
  assert.deepEqual(env.calls.map((c) => c.name), ["save_stylist_profile_v4"]);
  const a = env.calls[0].args;
  assert.deepEqual([a.p_career_phase, a.p_graduation_ym, a.p_blank_period_value, a.p_blank_period_unit], ["new_graduate", `${GRAD.y}-${String(GRAD.m).padStart(2, "0")}-01`, null, null]);
  assert.ok(!("p_graduation_kind" in a) && !("p_license_status" in a) && !("p_desired_start_ym" in a));
});

test("保存: ブランク期間（6ヶ月・2年）が数値と単位のセットで渡る。空欄は未入力", async () => {
  for (const [v, u] of [["6", "months"], ["2", "years"]] as const) {
    await run(form({ careerPhase: "blank", blankPeriodValue: v, blankPeriodUnit: u }));
    const a = env.calls[0].args;
    assert.deepEqual([a.p_blank_period_value, a.p_blank_period_unit], [Number(v), u]);
  }
  await run(form({ careerPhase: "blank", blankPeriodValue: "", blankPeriodUnit: "months" }));
  assert.deepEqual([env.calls[0].args.p_blank_period_value, env.calls[0].args.p_blank_period_unit], [null, null]);
});

test("検証: 新卒は卒業の年と月（3月/10月）が必須。ほかの月・範囲外・ブランク期間つきは保存しない。現役・ブランクに卒業年月は付けられない", async () => {
  const bad = async (extra: Record<string, string>, key: string) => { const r = await run(form(extra)); assert.ok(r.fieldErrors?.[key], JSON.stringify(extra)); assert.equal(env.calls.length, 0); };
  await bad({ careerPhase: "new_graduate" }, "graduationYm");
  await bad({ careerPhase: "new_graduate", graduationYear: String(GRAD.y) }, "graduationYm");
  await bad({ careerPhase: "new_graduate", graduationMonth: "3" }, "graduationYm");
  for (const m of ["1", "2", "4", "5", "6", "7", "8", "9", "11", "12", "0", "13"]) await bad({ careerPhase: "new_graduate", graduationYear: String(GRAD.y), graduationMonth: m }, "graduationYm");
  await bad({ careerPhase: "new_graduate", graduationYear: String(GRAD.y + 20), graduationMonth: "3" }, "graduationYm");
  await bad({ careerPhase: "new_graduate", graduationYear: "abc", graduationMonth: "3" }, "graduationYm");
  await bad({ careerPhase: "new_graduate", graduationYear: String(GRAD.y), graduationMonth: String(GRAD.m), blankPeriodValue: "6", blankPeriodUnit: "months" }, "careerPhase");
  await bad({ careerPhase: "blank", graduationYear: String(GRAD.y), graduationMonth: "3" }, "careerPhase");
  await bad({ careerPhase: "experienced", graduationYear: String(GRAD.y), graduationMonth: "3" }, "careerPhase");
  await bad({ careerPhase: "experienced", blankPeriodValue: "6", blankPeriodUnit: "months" }, "careerPhase");
  for (const v of ["0", "-1", "1.5", "abc", "6ヶ月", "１２", "121", "01"]) await bad({ careerPhase: "blank", blankPeriodValue: v, blankPeriodUnit: "months" }, "blankPeriod");
  await bad({ careerPhase: "blank", blankPeriodValue: "11", blankPeriodUnit: "years" }, "blankPeriod");
  await bad({ careerPhase: "blank", blankPeriodValue: "6", blankPeriodUnit: "weeks" }, "blankPeriod");
  await bad({ careerPhase: "blank", blankPeriodValue: "6", blankPeriodUnit: "" }, "blankPeriod");
});

test("DB対応: 立場の読み取りに失敗したら保存しない。v4が失敗しても旧い経路へ切り替えない（必須の回避を作らない）", async () => {
  const r = await run(form({ careerPhase: "experienced" }), "error");
  assert.ok(r.error && env.calls.length === 0);
  const r2 = await run(form({ careerPhase: "experienced" }), "ok-null", { message: "function save_stylist_profile_v4 does not exist" });
  assert.ok(r2.error && !r2.success);
  assert.deepEqual(env.calls.map((c) => c.name), ["save_stylist_profile_v4"], "v3・v2・旧関数へフォールバックしない");
});

test("生年月日なしなら v4 は呼ばず、立場だけ保存することもない", async () => {
  const r = await run(form({ careerPhase: "blank" }, ["birthDate", "ageDisplayMode"]));
  assert.ok(r.fieldErrors?.birthDate && env.calls.length === 0);
});

test("0071未適用のDBだけは、立場なしで従来どおり保存する（立場を要求しない）", async () => {
  const r = await run(form({}, ["careerPhase"]), "unsupported");
  assert.equal(r.success, "プロフィールを保存しました。");
  assert.deepEqual(env.calls.map((c) => c.name), ["save_stylist_profile_v2"]);
  assert.ok(!("p_career_phase" in env.calls[0].args));
});

import { readFileSync } from "node:fs";
test("画面: 新規登録ウィザードは立場が未選択のままでは次へ進めない。編集・新規とも同じ入力欄を使う", () => {
  const w = readFileSync("components/profile/stylist-onboarding-wizard.tsx", "utf8");
  assert.ok(w.includes("CAREER_PHASE_REQUIRED_MESSAGE") && w.includes('get("careerPhase")') && w.includes("<CareerPhaseField"));
  const pf = readFileSync("components/profile/profile-form.tsx", "utf8");
  assert.ok(pf.includes("<CareerPhaseField"));
  const field = readFileSync("components/profile/career-phase-field.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/defaultChecked|checked=\{true\}/.test(field) && !field.includes("選ばない（未設定）") && !field.includes("value=\"student\"") && !field.includes("美容学生"));
});

import { parseCareerPhaseInput, readOwnCareerPhase, ymToDate, graduationYearOptions, isAllowedGraduationYm } from "../lib/student-diagnosis/career-phase";
test("保存後の再表示: 保存した値（v4へ渡す値）を読み戻すと、入力した立場・卒業年月・ブランク期間と一致する", async () => {
  const gy = String(GRAD.y), gm = String(GRAD.m);
  const cases = [
    { phase: "experienced" }, { phase: "blank" },
    { phase: "blank", blankPeriodValue: "6", blankPeriodUnit: "months" }, { phase: "blank", blankPeriodValue: "2", blankPeriodUnit: "years" },
    { phase: "new_graduate", graduationYear: gy, graduationMonth: gm },
  ];
  for (const c of cases) {
    const p = parseCareerPhaseInput(c);
    assert.ok(p.ok, JSON.stringify(c));
    if (!p.ok) continue;
    const v = p.value; // DBへ渡す値 → DBの行 → 画面の初期値
    const row = { career_phase: v.phase, graduation_ym: ymToDate(v.graduationYm), blank_period_value: v.blankPeriod?.value ?? null, blank_period_unit: v.blankPeriod?.unit ?? null };
    const mk = () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) }) as never;
    const back = await readOwnCareerPhase(mk(), "u");
    assert.deepEqual(back, { status: "ok", value: v }, JSON.stringify(c));
  }
});
test("選べる卒業年: 既存の許容範囲（3年前〜5年後）の中に3月か10月が入る年。月は3月・10月だけ", () => {
  const NOW = new Date("2026-11-15T09:00:00+09:00");
  assert.deepEqual(graduationYearOptions(NOW), [2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031]);
  assert.equal(isAllowedGraduationYm("2023-10", NOW), false, "範囲外（2023年11月より前）");
  assert.equal(isAllowedGraduationYm("2024-03", NOW), true);
  assert.equal(isAllowedGraduationYm("2031-03", NOW), true);
  assert.equal(isAllowedGraduationYm("2031-10", NOW), true, "2031年11月（5年後）まで");
  assert.equal(isAllowedGraduationYm("2032-03", NOW), false, "範囲外（2031年11月より後）");
  assert.equal(isAllowedGraduationYm("2027-05", NOW), false);
  const NOW2 = new Date("2026-04-15T09:00:00+09:00");
  assert.deepEqual(graduationYearOptions(NOW2), [2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031]);
});
