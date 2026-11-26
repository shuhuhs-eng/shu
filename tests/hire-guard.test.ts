import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hiredStatusBlockedReason, HIRE_GUARD_LIVE, HIRE_GUARD_UNKNOWN } from "../lib/billing/hire-guard";

const ON = { HIRE_BILLING_ENABLED: "1" };
const fake = (res: { data?: unknown; error?: { message: string; code?: string } | null } | "throw") => ({
  rpc: async () => { if (res === "throw") throw new Error("network"); return { data: res.data ?? null, error: res.error ?? null }; },
}) as never;

test("サーバー側: 契約情報の取得に失敗したら、旧「採用にする」は拒否される（契約なし扱いにしない）", async () => {
  assert.equal(await hiredStatusBlockedReason(fake({ error: { message: "boom" } }), "p", ON), HIRE_GUARD_UNKNOWN);
  assert.equal(await hiredStatusBlockedReason(fake("throw"), "p", ON), HIRE_GUARD_UNKNOWN);
  assert.equal(await hiredStatusBlockedReason(fake({ data: [1, 2] }), "p", ON), HIRE_GUARD_UNKNOWN);   // 形式が不正な応答も「契約なし」にしない
  assert.equal(await hiredStatusBlockedReason(fake({ error: { message: "x", code: "PGRST202" } }), "p", ON), HIRE_GUARD_UNKNOWN);   // DB機能が未適用でも、フラグが有効なら止める
});
test("サーバー側: 有効な契約があれば旧「採用にする」は拒否・辞退/取消済みと契約なしは続行", async () => {
  for (const st of ["awaiting_intent", "awaiting_salon", "confirmed"]) assert.equal(await hiredStatusBlockedReason(fake({ data: { status: st } }), "p", ON), HIRE_GUARD_LIVE);
  for (const st of ["declined", "cancelled"]) assert.equal(await hiredStatusBlockedReason(fake({ data: { status: st } }), "p", ON), null);
  assert.equal(await hiredStatusBlockedReason(fake({ data: null }), "p", ON), null);   // 契約が開かれていない（成功して null）
});
test("サーバー側: 機能フラグが無効なら何もしない（契約のRPCも呼ばない）", async () => {
  let called = 0; const c = { rpc: async () => { called++; return { data: null, error: null }; } } as never;
  assert.equal(await hiredStatusBlockedReason(c, "p", {}), null);
  assert.equal(await hiredStatusBlockedReason(c, "p", { HIRE_BILLING_ENABLED: "0" }), null);
  assert.equal(called, 0);
});
test("採用状況の更新処理は、hired のとき更新RPCの前に必ずこの判定を通る（順序と他の状態を妨げないこと）", () => {
  const src = readFileSync(new URL("../lib/hiring/actions.ts", import.meta.url), "utf8");
  const i = src.indexOf("export async function updateHiringStatusAction"); const body = src.slice(i, src.indexOf("\nconst noteSchema", i));
  const g = body.indexOf('hiredStatusBlockedReason(supabase, v.processId)'); const r = body.indexOf('supabase.rpc("update_hiring_status"');
  assert.ok(g > 0 && r > g, "判定が更新RPCより前にある");
  assert.ok(body.slice(0, g).includes('v.toStatus === "hired"'), "hired のときだけ判定する");
  assert.ok(body.slice(g, r).includes("return { success: false, error: blocked }"), "止めるときは更新RPCを呼ばずに返す");
});
