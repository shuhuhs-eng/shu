// saveProfileAction の年齢まわり: DB対応の判定はサーバー側（DBを読む）で行い、フォームの項目欠落では判断しない。
// 対応済みDBでは save_stylist_profile_v2 を1回だけ呼ぶ（生年月日・表示方法・プロフィールを1トランザクションで保存）。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

type Call = { name: string; args: Record<string, unknown> };
const env: { support: "ok" | "unsupported" | "error"; rpcError: boolean; calls: Call[]; removed: string[][] } = {
  support: "ok", rpcError: false, calls: [], removed: [],
};

function fakeSupabase() {
  const chain = (table: string, cols: string) => ({
    eq: () => ({
      single: async () => ({ data: { id: "u1", avatar_path: "u1/avatar.webp" }, error: null }),
      maybeSingle: async () => {
        if (table === "stylist_private" && cols === "age_display_mode") {
          if (env.support === "unsupported") return { data: null, error: { code: "42703", message: 'column "age_display_mode" does not exist' } };
          if (env.support === "error") return { data: null, error: { code: "XX000", message: "boom" } };
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
    }),
  });
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (table: string) => ({ select: (cols: string) => chain(table, cols) }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      env.calls.push({ name, args });
      return { data: null, error: env.rpcError ? { message: "failed" } : null };
    },
    storage: { from: () => ({ remove: async (p: string[]) => { env.removed.push(p); return { error: null }; } }) },
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

function form(extra: Record<string, string | string[]> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string | string[]> = {
    publicName: "さくら", prefecture: "東京都", experienceYears: "3", specialties: ["カット"], employmentType: "full_time",
    jobChangeIntent: "passive", fullName: "山田 花子", ageBand: "30_34", gender: "female",
    valuePriorities: ["work_life_balance", "skill_growth", "income_stability"], visibility: "PUBLIC",
    desiredWorkLocation: "", currentPosition: "", bio: "", avatarPath: "", ...extra,
  };
  for (const [k, v] of Object.entries(base)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
const run = async (f: FormData, support: typeof env.support = "ok", rpcError = false) => {
  env.support = support; env.rpcError = rpcError; env.calls = []; env.removed = [];
  return saveProfileAction({}, f);
};
const names = () => env.calls.map((c) => c.name);

test("対応済みDB: 表示方法が未選択（ラジオ未送信）のフォーム送信は拒否され、DBへ何も送らない", async () => {
  const r = await run(form({ birthDate: "1990-04-01" })); // ageDisplayMode を送らない = 実際のフォームで未選択
  assert.ok(r.error);
  assert.deepEqual(r.fieldErrors?.ageDisplayMode, ["年齢の表示方法を選択してください"]);
  assert.deepEqual(names(), []);
});

test("対応済みDB: 生年月日の欠落も拒否され、DBへ何も送らない", async () => {
  const r = await run(form({ ageDisplayMode: "decade" }));
  assert.ok(r.error);
  assert.deepEqual(r.fieldErrors?.birthDate, ["生年月日を入力してください"]);
  assert.deepEqual(names(), []);
});

test("対応済みDB: 表示方法が空・不正値でも拒否される", async () => {
  for (const bad of ["", "both"]) {
    const r = await run(form({ birthDate: "1990-04-01", ageDisplayMode: bad }));
    assert.ok(r.error, `mode=${JSON.stringify(bad)}`);
    assert.deepEqual(names(), []);
  }
});

test("対応済みDB: 保存は save_stylist_profile_v2 の1回だけ（生年月日・表示方法・公開設定を一緒に渡す）", async () => {
  const r = await run(form({ birthDate: "1990-04-01", ageDisplayMode: "exact", visibility: "PRIVATE" }));
  assert.ok(r.success, JSON.stringify(r));
  assert.deepEqual(names(), ["save_stylist_profile_v2"]);
  const a = env.calls[0].args;
  assert.equal(a.p_birth_date, "1990-04-01");
  assert.equal(a.p_age_display_mode, "exact");
  assert.equal(a.p_visibility, "PRIVATE");
});

test("対応済みDB: 保存RPCが失敗しても、別々の書き込み（生年月日・表示方法の単独保存）は行われない", async () => {
  const r = await run(form({ birthDate: "1990-04-01", ageDisplayMode: "exact" }), "ok", true);
  assert.ok(r.error);
  assert.deepEqual(names(), ["save_stylist_profile_v2"]);
  assert.deepEqual(env.removed, []);
});

test("DB未対応（0070未適用）: 従来の save_stylist_profile だけで保存できる（v2・単独保存は呼ばない）", async () => {
  const r = await run(form(), "unsupported");
  assert.ok(r.success, JSON.stringify(r));
  assert.deepEqual(names(), ["save_stylist_profile"]);
  assert.ok(!("p_birth_date" in env.calls[0].args) && !("p_age_display_mode" in env.calls[0].args));
});

test("DB未対応の判断はフォームの項目欠落ではなくDBの読み取りで行う（対応済みDBで項目が全く無くても通らない）", async () => {
  const r = await run(form(), "ok");
  assert.ok(r.error);
  assert.deepEqual(names(), []);
});

test("DB未対応でも、古い画面から生年月日・表示方法が届いたらそれは使わず従来保存する", async () => {
  const r = await run(form({ birthDate: "1990-04-01", ageDisplayMode: "exact" }), "unsupported");
  assert.ok(r.success);
  assert.deepEqual(names(), ["save_stylist_profile"]);
});

test("対応状況を読み取れない（DBエラー）ときは推測せず、何も保存しない", async () => {
  const r = await run(form({ birthDate: "1990-04-01", ageDisplayMode: "exact" }), "error");
  assert.ok(r.error);
  assert.deepEqual(names(), []);
});
