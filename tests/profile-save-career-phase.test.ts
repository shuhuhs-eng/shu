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
              return { data: { career_phase: cp, graduation_ym: cp === "student" ? "2027-03-01" : null, graduation_kind: cp === "student" ? "planned" : null, desired_start_ym: null, license_status: null }, error: null };
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
    const r = await run(form({ careerPhase: bad, graduationYm: ymOffset(6), graduationKind: "planned" }));
    assert.ok(r.fieldErrors?.careerPhase, bad);
    assert.equal(env.calls.length, 0);
  }
});

test("保存: 3択それぞれが v3 の1回で保存される（プロフィールと立場を別々に呼ばない・旧関数は呼ばない）", async () => {
  for (const ph of ["experienced", "blank"] as const) {
    const r = await run(form({ careerPhase: ph }));
    assert.equal(r.success, "プロフィールを保存しました。");
    assert.deepEqual(env.calls.map((c) => c.name), ["save_stylist_profile_v3"]);
    const a = env.calls[0].args;
    assert.equal(a.p_career_phase, ph);
    assert.deepEqual([a.p_graduation_ym, a.p_graduation_kind, a.p_desired_start_ym, a.p_license_status], [null, null, null, null]);
    assert.equal(a.p_birth_date, "1990-04-01");
  }
  const g = ymOffset(6), s = ymOffset(8);
  const r = await run(form({ careerPhase: "new_graduate", graduationYm: g, graduationKind: "planned", desiredStartYm: s, licenseStatus: "studying" }), "ok-student");
  assert.equal(r.success, "プロフィールを保存しました。");
  assert.deepEqual(env.calls.map((c) => c.name), ["save_stylist_profile_v3"]);
  const a = env.calls[0].args;
  assert.deepEqual([a.p_career_phase, a.p_graduation_ym, a.p_graduation_kind, a.p_desired_start_ym, a.p_license_status], ["new_graduate", `${g}-01`, "planned", `${s}-01`, "studying"]);
});

test("検証: 新卒は卒業年月・区分が必須。現役・ブランクありに卒業情報は付けられない（保存しない）", async () => {
  assert.ok((await run(form({ careerPhase: "new_graduate" }))).fieldErrors?.graduationYm); assert.equal(env.calls.length, 0);
  assert.ok((await run(form({ careerPhase: "new_graduate", graduationYm: ymOffset(6) }))).fieldErrors?.graduationKind); assert.equal(env.calls.length, 0);
  assert.ok((await run(form({ careerPhase: "blank", licenseStatus: "obtained" }))).fieldErrors?.careerPhase); assert.equal(env.calls.length, 0);
  assert.ok((await run(form({ careerPhase: "experienced", graduationYm: ymOffset(1) }))).fieldErrors?.careerPhase); assert.equal(env.calls.length, 0);
});

test("DB対応: 立場の読み取りに失敗したら保存しない。v3が失敗しても旧い経路へ切り替えない（必須の回避を作らない）", async () => {
  const r = await run(form({ careerPhase: "experienced" }), "error");
  assert.ok(r.error && env.calls.length === 0);
  const r2 = await run(form({ careerPhase: "experienced" }), "ok-null", { message: "function save_stylist_profile_v3 does not exist" });
  assert.ok(r2.error && !r2.success);
  assert.deepEqual(env.calls.map((c) => c.name), ["save_stylist_profile_v3"], "v2・旧関数へフォールバックしない");
});

test("生年月日なしなら v3 は呼ばず、立場だけ保存することもない", async () => {
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

import { parseCareerPhaseInput, readOwnCareerPhase, ymToDate } from "../lib/student-diagnosis/career-phase";
test("保存後の再表示: 保存した値（v3へ渡す値）を読み戻すと、入力した立場・卒業・就業開始・免許と一致する", async () => {
  const cases = [
    { phase: "experienced" }, { phase: "blank" },
    { phase: "new_graduate", graduationYm: ymOffset(-2), graduationKind: "completed", desiredStartYm: ymOffset(1), licenseStatus: "obtained" },
    { phase: "new_graduate", graduationYm: ymOffset(6), graduationKind: "planned" },
  ];
  for (const c of cases) {
    const p = parseCareerPhaseInput(c);
    assert.ok(p.ok, JSON.stringify(c));
    if (!p.ok) continue;
    const v = p.value; // DBへ渡す値 → DBの行 → 画面の初期値
    const row = { career_phase: v.phase, graduation_ym: ymToDate(v.graduationYm), graduation_kind: v.graduationKind, desired_start_ym: ymToDate(v.desiredStartYm), license_status: v.licenseStatus };
    const mk = () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) }) as never;
    const back = await readOwnCareerPhase(mk(), "u");
    assert.deepEqual(back, { status: "ok", value: v }, JSON.stringify(c));
  }
});
