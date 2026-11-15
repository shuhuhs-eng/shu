// 診断結果の「大切にしたい働き方」をプロフィールへ反映する処理。自動保存しない・推測で変換しない・ほかの保存済み項目は変えない。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

type Row = Record<string, unknown>;
const db: { stylist_profiles: Row; stylist_private: Row; profiles: Row; user_settings: Row | null; rpcCalls: { name: string; args: Record<string, unknown> }[]; failRpc: boolean; failRead: string | null; user: { id: string } | null } = {
  stylist_profiles: {}, stylist_private: {}, profiles: {}, user_settings: null, rpcCalls: [], failRpc: false, failRead: null, user: { id: "u1" },
};
const STORED = () => ({
  stylist_profiles: {
    user_id: "u1", public_name: "さくら", prefecture: "東京都", desired_work_location: "渋谷", experience_years: 0, current_position: "スタイリスト",
    specialties: ["カット"], employment_type: "full_time", job_change_intent: "active", desired_salary_range: "300_350", sns_links: [{ platform: "instagram", handle: "sakura" }, { platform: "x", handle: "s" }],
    bio: "自己紹介", visibility: "PARTIAL", value_priorities: ["work_life_balance", "skill_growth", "income_stability"],
  },
  stylist_private: { user_id: "u1", full_name: "山田 花子", age_band: "30_34", gender: "female", birth_date: "1990-04-01", age_display_mode: "decade" },
  profiles: { id: "u1", avatar_path: "u1/avatar.webp" },
  user_settings: { user_id: "u1", scout_enabled: false },
});
function reset(mut?: (s: ReturnType<typeof STORED>) => void) {
  const s = STORED(); mut?.(s);
  db.stylist_profiles = s.stylist_profiles; db.stylist_private = s.stylist_private; db.profiles = s.profiles; db.user_settings = s.user_settings;
  db.rpcCalls = []; db.failRpc = false; db.failRead = null; db.user = { id: "u1" };
}
function fakeSupabase() {
  const table = (t: string) => (db as unknown as Record<string, Row | null>)[t];
  return {
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: (t: string) => ({ select: (cols: string) => ({ eq: () => ({ maybeSingle: async () => {
      if (db.failRead === t) return { data: null, error: { code: "XX000", message: "boom" } };
      const row = table(t);
      if (!row || Object.keys(row).length === 0) return { data: null, error: null };
      if (cols === "*") return { data: { ...row }, error: null };
      return { data: Object.fromEntries(cols.split(",").map((c) => [c.trim(), row[c.trim()] ?? null])), error: null };
    } }) }) }),
    // 保存経路の代わり（実DBの save_stylist_profile(_v2) と同じく、渡された値で行を置き換える）
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.rpcCalls.push({ name, args });
      if (db.failRpc) return { data: null, error: { message: "failed" } };
      const p = db.stylist_profiles, q = db.stylist_private;
      Object.assign(p, { public_name: args.p_public_name, prefecture: args.p_prefecture, desired_work_location: args.p_desired_work_location, experience_years: args.p_experience_years,
        current_position: args.p_current_position, specialties: args.p_specialties, employment_type: args.p_employment_type, job_change_intent: args.p_job_change_intent,
        desired_salary_range: args.p_desired_salary_range, sns_links: args.p_sns_links, bio: args.p_bio, visibility: args.p_visibility, value_priorities: args.p_value_priorities });
      Object.assign(q, { full_name: args.p_full_name, age_band: args.p_age_band, gender: args.p_gender });
      if (name === "save_stylist_profile_v2") Object.assign(q, { birth_date: args.p_birth_date, age_display_mode: args.p_age_display_mode });
      db.profiles.avatar_path = args.p_avatar_path;
      db.user_settings = { user_id: "u1", scout_enabled: args.p_scout_enabled };
      return { data: null, error: null };
    },
  };
}
const originalLoad = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/cache") return { revalidatePath: () => undefined };
  if (request === "@/lib/supabase/server") return { createClient: async () => fakeSupabase() };
  return originalLoad.call(this, request, ...rest);
};
after(() => { (Module as unknown as { _load: unknown })._load = originalLoad; });
/* eslint-disable @typescript-eslint/no-require-imports */
const { applyValuePrioritiesAction } = require("../lib/profile/apply-diagnosis-actions");
const { proposeValuePriorities, validateValuePriorities, buildSaveParams, readStoredProfileForSave } = require("../lib/profile/apply-diagnosis-values");
const { ApplyValuesToProfile } = require("../components/student-diagnosis/apply-values-to-profile");
/* eslint-enable @typescript-eslint/no-require-imports */

const fd = (vals: string[]) => { const f = new FormData(); vals.forEach((v) => f.append("valuePriorities", v)); return f; };
const snapshot = () => JSON.stringify({ p: db.stylist_profiles, q: db.stylist_private, a: db.profiles, s: db.user_settings });

test("変更案: 診断の選択（選んだ順）と同じ一覧のコードだけ。一覧に無いコードは変換せず除く。3つに足りなければ不足数を返す（補わない）", () => {
  assert.deepEqual(proposeValuePriorities(["teamwork", "independence", "culture_fit"]), { proposed: ["teamwork", "independence", "culture_fit"], missing: 0, dropped: 0 });
  assert.deepEqual(proposeValuePriorities(["teamwork", "independence"]), { proposed: ["teamwork", "independence"], missing: 1, dropped: 0 });
  const r = proposeValuePriorities(["teamwork", "legacy_unknown_code", "teamwork"]);
  assert.deepEqual(r.proposed, ["teamwork"]);
  assert.equal(r.missing, 2);
  assert.equal(proposeValuePriorities([]).missing, 3);
});
test("検証: プロフィールの既存ルール（ちょうど3つ・一覧にあるもの・重複禁止）", () => {
  assert.equal(validateValuePriorities(["teamwork", "independence", "culture_fit"]).ok, true);
  for (const bad of [["teamwork", "independence"], ["teamwork", "teamwork", "independence"], ["teamwork", "independence", "culture_fit", "skill_growth"], ["teamwork", "independence", "nope"], []]) {
    assert.equal(validateValuePriorities(bad).ok, false, JSON.stringify(bad));
  }
});
test("保存: value_priorities だけが変わり、ほかの保存済み項目（公開範囲の一部公開・経験年数0・SNS・受信設定・生年月日等）は変わらない", async () => {
  reset();
  const before = JSON.parse(snapshot());
  const r = await applyValuePrioritiesAction({ status: "idle" }, fd(["culture_fit", "teamwork", "independence"]));
  assert.equal(r.status, "saved");
  assert.equal(db.rpcCalls.length, 1);
  assert.equal(db.rpcCalls[0].name, "save_stylist_profile_v2", "既存の保存経路");
  const after = JSON.parse(snapshot());
  assert.deepEqual(after.p.value_priorities, ["culture_fit", "teamwork", "independence"]);
  before.p.value_priorities = after.p.value_priorities;
  assert.deepEqual(after, before, "value_priorities 以外は一切変わらない");
  assert.equal(after.p.visibility, "PARTIAL");
  assert.equal(after.p.experience_years, 0);
  assert.equal(after.s.scout_enabled, false);
});
test("保存の入力: 3つ未満・重複・一覧外は保存しない（DBへ何も送らない）", async () => {
  for (const bad of [["teamwork"], ["teamwork", "teamwork", "independence"], ["teamwork", "independence", "nope"]]) {
    reset(); const before = snapshot();
    const r = await applyValuePrioritiesAction({ status: "idle" }, fd(bad));
    assert.equal(r.status, "error"); assert.equal(db.rpcCalls.length, 0); assert.equal(snapshot(), before);
  }
});
test("保存しない場合: 未ログイン／プロフィール未保存／生年月日・表示方法が未登録／読み取り失敗", async () => {
  reset(); db.user = null;
  assert.equal((await applyValuePrioritiesAction({ status: "idle" }, fd(["a", "b", "c"].map(() => "teamwork")))).status, "error");
  reset(); db.user = { id: "u1" }; db.stylist_profiles = {};
  let r = await applyValuePrioritiesAction({ status: "idle" }, fd(["teamwork", "independence", "culture_fit"]));
  assert.equal(r.status, "error"); assert.match(r.message, /先にプロフィールを保存/); assert.equal(db.rpcCalls.length, 0);
  reset((s) => { (s.stylist_private as Record<string, unknown>).age_display_mode = null; });
  r = await applyValuePrioritiesAction({ status: "idle" }, fd(["teamwork", "independence", "culture_fit"]));
  assert.equal(r.status, "error"); assert.match(r.message, /生年月日と年齢の表示方法/); assert.equal(db.rpcCalls.length, 0);
  for (const t of ["stylist_profiles", "stylist_private", "profiles", "user_settings"]) {
    reset(); db.failRead = t;
    r = await applyValuePrioritiesAction({ status: "idle" }, fd(["teamwork", "independence", "culture_fit"]));
    assert.equal(r.status, "error", t); assert.equal(db.rpcCalls.length, 0, "読み取り失敗のときは推測で保存しない: " + t);
  }
});
test("保存失敗: エラーを返し、保存済みの内容は変わらない", async () => {
  reset(); db.failRpc = true; const before = snapshot();
  const r = await applyValuePrioritiesAction({ status: "idle" }, fd(["teamwork", "independence", "culture_fit"]));
  assert.equal(r.status, "error"); assert.equal(snapshot(), before);
});
test("保存のパラメータ: 通常のプロフィール保存（actions.ts）と同じ項目が揃っている（欠け・余りなし）。0070前（v1）は生年月日を渡さない", async () => {
  const src = readFileSync("lib/profile/actions.ts", "utf8");
  const block = src.slice(src.indexOf("const common = {"), src.indexOf("let error"));
  const expected = [...block.matchAll(/\b(p_[a-z_]+):/g)].map((m) => m[1]).sort();
  reset();
  const read = await readStoredProfileForSave(fakeSupabase(), "u1");
  assert.equal(read.status, "ok");
  const v2 = buildSaveParams(read.stored, ["teamwork", "independence", "culture_fit"]);
  assert.deepEqual(Object.keys(v2.params).filter((k) => k !== "p_birth_date" && k !== "p_age_display_mode").sort(), expected);
  assert.deepEqual(Object.keys(v2.params).filter((k) => k === "p_birth_date" || k === "p_age_display_mode").sort(), ["p_age_display_mode", "p_birth_date"]);
  const v1 = buildSaveParams({ ...read.stored, age: { kind: "v1" } }, ["teamwork", "independence", "culture_fit"]);
  assert.equal(v1.fn, "save_stylist_profile"); assert.ok(!("p_birth_date" in v1.params));
});

const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(ApplyValuesToProfile as never, { action: async () => ({ status: "idle" }), ...props } as never));
test("画面（初期）: 押すまで何も保存しない。ボタンだけを出し、入力欄・送信用の値はまだ無い", () => {
  const h = render({ diagnosisValues: ["teamwork", "independence", "culture_fit"], current: ["work_life_balance"], hasProfile: true });
  assert.ok(h.includes("プロフィールに反映する") && h.includes("押すまでは何も変わりません"));
  assert.ok(!h.includes('name="valuePriorities"') && !h.includes("<form"));
  const noProfile = render({ diagnosisValues: [], current: null, hasProfile: false });
  assert.ok(noProfile.includes("先にプロフィールを保存") && !noProfile.includes("プロフィールに反映する</button>"));
});
test("画面の構造: 結果ページは現在の結果のときだけ反映欄", () => {
  const res = readFileSync("app/stylist/diagnosis/student/result/page.tsx", "utf8");
  assert.ok(res.includes('status === "current" && profileRead') && res.includes("<ApplyValuesToProfile"));
});
