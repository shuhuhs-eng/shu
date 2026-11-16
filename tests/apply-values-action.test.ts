// 「大切にしたい働き方」の反映（applyValuePrioritiesAction）。専用関数の呼び出し1回だけ・他の項目は更新しない・失敗は成功にしない。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

type Call = { name: string; args: Record<string, unknown> };
const env: { user: boolean; err: { code?: string; message: string } | null; calls: Call[]; tables: string[]; revalidated: string[] } = { user: true, err: null, calls: [], tables: [], revalidated: [] };
const fake = {
  auth: { getUser: async () => ({ data: { user: env.user ? { id: "u1" } : null }, error: null }) },
  from: (t: string) => { env.tables.push(t); throw new Error("from() は使わない: " + t); },
  rpc: async (name: string, args: Record<string, unknown>) => { env.calls.push({ name, args }); return { data: null, error: env.err }; },
};
const orig = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/cache") return { revalidatePath: (p: string) => env.revalidated.push(p) };
  if (request === "@/lib/supabase/server") return { createClient: async () => fake };
  return orig.call(this, request, ...rest);
};
after(() => { (Module as unknown as { _load: unknown })._load = orig; });
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { applyValuePrioritiesAction } = require("../lib/profile/apply-values-actions");
const reset = () => { env.user = true; env.err = null; env.calls = []; env.tables = []; env.revalidated = []; };
const V = ["teamwork", "independence", "culture_fit"];

test("成功: set_stylist_value_priorities を1回だけ、3項目の配列だけで呼ぶ（他のRPC・テーブル更新なし）。関連画面を再検証", async () => {
  reset();
  const r = await applyValuePrioritiesAction(V);
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(env.calls, [{ name: "set_stylist_value_priorities", args: { p_value_priorities: V } }]);
  assert.deepEqual(env.tables, []);
  assert.ok(env.revalidated.includes("/stylist/profile") && env.revalidated.includes("/stylist/diagnosis/student/result"));
});
test("不正な値は送らない: 3つ未満・4つ・重複・一覧外・配列でない（DBへ呼ばない）", async () => {
  for (const bad of [["teamwork", "independence"], [...V, "skill_growth"], ["teamwork", "teamwork", "independence"], ["teamwork", "independence", "nope"], [], null, "x"]) {
    reset();
    const r = await applyValuePrioritiesAction(bad as never);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(env.calls.length, 0);
  }
});
test("未ログインは保存しない", async () => {
  reset(); env.user = false;
  const r = await applyValuePrioritiesAction(V);
  assert.equal(r.ok, false); assert.equal(env.calls.length, 0);
});
test("失敗は成功と扱わない: プロフィール未保存・DB拒否・関数なし（0072未適用）・通信エラー。再検証もしない", async () => {
  const cases: [{ code?: string; message: string }, RegExp][] = [
    [{ code: "P0002", message: "profile_not_found" }, /先にプロフィールを保存/],
    [{ code: "22023", message: "invalid_value_priorities" }, /選び直して/],
    [{ code: "PGRST202", message: "function not found" }, /ご利用いただけません/],
    [{ code: "XX000", message: "boom" }, /失敗しました/],
  ];
  for (const [err, re] of cases) {
    reset(); env.err = err;
    const r = await applyValuePrioritiesAction(V);
    assert.equal(r.ok, false);
    assert.ok(re.test((r as { message: string }).message), err.code);
    assert.equal(env.revalidated.length, 0);
  }
});
