// 通知既読化の「1回200件」制限に伴う呼び出し側の分割(回帰修正)の自動試験。
// ①200/201/401件の分割(切り捨てなし・各回200件以下) ②全件成功時だけ成功 ③途中失敗・通信例外は成功扱いにせず残りを返す(再試行可)
// ④他カードの未読に触れない(送る組は渡した組だけ) ⑤実サーバーアクション(検証前の上限200)と組み合わせても通る。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { badgeOutcome, chunkEntities, markEntitiesReadInChunks, ENTITY_CHUNK_SIZE, type NotificationEntity } from "../lib/notifications/entity-chunks";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ents = (n: number, type = "salon", from = 1): NotificationEntity[] => Array.from({ length: n }, (_, i) => ({ type, id: uuid(from + i) }));
const key = (e: NotificationEntity) => `${e.type}:${e.id}`;

// ---- 実サーバーアクション(検証前の上限つき)を、記録つきの疑似DBで動かす ----
type Plan = { failOnCall?: number; throwOnCall?: number };
const state: { calls: NotificationEntity[][]; plan: Plan } = { calls: [], plan: {} };
const fake = { rpc: async (name: string, args: { p_entities: NotificationEntity[] }) => {
  assert.equal(name, "mark_notifications_read_by_entities");
  state.calls.push(args.p_entities); const n = state.calls.length;
  if (state.plan.throwOnCall === n) throw new Error("network down");
  if (state.plan.failOnCall === n) return { data: null, error: { message: "boom" } };
  return { data: args.p_entities.length, error: null };
} };
const originalLoad = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/cache") return { revalidatePath: () => undefined };
  if (request === "@/lib/supabase/server") return { createClient: async () => fake };
  return originalLoad.call(this, request, ...rest);
};
after(() => { (Module as unknown as { _load: unknown })._load = originalLoad; });
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { markNotificationsReadForEntities } = require("../lib/notifications/actions");
const run = (e: NotificationEntity[], plan: Plan = {}) => { state.calls = []; state.plan = plan; return markEntitiesReadInChunks(e, markNotificationsReadForEntities); };
const sent = () => state.calls.flat().map(key);

test("分割: 200件=1回・201件=2回・401件=3回。切り捨てなし・各回200件以下・順序保持", async () => {
  assert.equal(ENTITY_CHUNK_SIZE, 200);
  for (const [n, sizes] of [[1, [1]], [199, [199]], [200, [200]], [201, [200, 1]], [400, [200, 200]], [401, [200, 200, 1]]] as const) {
    const input = ents(n); const chunks = chunkEntities(input);
    assert.deepEqual(chunks.map((c) => c.length), sizes, `${n}件`);
    assert.deepEqual(chunks.flat().map(key), input.map(key), `${n}件: 全件が順序どおり1回ずつ`);
  }
  assert.deepEqual(chunkEntities([]), []);
  const dup = [...ents(3), ...ents(3)]; assert.equal(chunkEntities(dup).flat().length, 3, "同一の組の重複だけ除く");
});

test("実アクションと結合: 200/201/401件はすべて成功し、全件がちょうど1回ずつ送られる(各回200件以下)", async () => {
  for (const [n, calls] of [[200, 1], [201, 2], [401, 3]] as const) {
    const input = ents(n); const r = await run(input);
    assert.equal(r.ok, true, `${n}件`); assert.equal(r.calls, calls); assert.ok(state.calls.every((c) => c.length <= 200));
    assert.deepEqual(sent(), input.map(key), `${n}件: 切り捨て・重複送信なし`);
    if (r.ok) assert.equal(r.marked, n);
  }
});

test("途中の処理失敗: 成功扱いにせず、失敗した回以降の未処理分をそのまま返す(再試行できる)", async () => {
  const input = ents(401);
  const r = await run(input, { failOnCall: 2 });
  assert.equal(r.ok, false); if (r.ok) return;
  assert.equal(r.reason, "failed"); assert.equal(r.calls, 2, "失敗した回で止まる(3回目は呼ばない)");
  assert.deepEqual(r.remaining.map(key), input.slice(200).map(key), "未処理=2回目以降の201件(1回目の200件は処理済み)");
  // 再試行: 残りだけを送ると、残り全件が送られて成功する。処理済みの分は再送しない。
  const again = await run(r.remaining); assert.equal(again.ok, true); assert.deepEqual(sent(), input.slice(200).map(key));
  const first = await run(input, { failOnCall: 1 }); assert.equal(first.ok, false); if (!first.ok) assert.equal(first.remaining.length, 401, "最初の回の失敗: 未処理は全件");
  const last = await run(input, { failOnCall: 3 }); assert.equal(last.ok, false); if (!last.ok) assert.deepEqual(last.remaining.map(key), [key(input[400])], "最後の回の失敗: 未処理は最後の1件");
});

test("通信例外(通信断など): 成功扱いにせず、未処理分を返す", async () => {
  const input = ents(250);
  const r = await run(input, { throwOnCall: 1 }); assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.reason, "exception"); assert.equal(r.remaining.length, 250); }
  const r2 = await run(input, { throwOnCall: 2 }); assert.equal(r2.ok, false);
  if (!r2.ok) { assert.equal(r2.reason, "exception"); assert.deepEqual(r2.remaining.map(key), input.slice(200).map(key)); }
});

test("サーバー側の検証前の上限は維持: 201件を1回で送ると拒否・巨大入力はRPCへ進まない", async () => {
  state.calls = []; state.plan = {};
  assert.equal((await markNotificationsReadForEntities(ents(201))).success, false);
  assert.equal((await markNotificationsReadForEntities(ents(200))).success, true);
  state.calls = []; assert.equal((await markNotificationsReadForEntities(Array.from({ length: 200_000 }, () => ({ type: 1, id: "x" })))).success, false); assert.deepEqual(state.calls, []);
});

test("他カードの未読に影響しない: 送るのは渡した組だけ。別カードの組は一度も送られない", async () => {
  const cardA = ents(401, "salon", 1), cardB = ents(30, "stylist", 100000);
  const r = await run(cardA); assert.equal(r.ok, true);
  const sentSet = new Set(sent()); assert.equal(sentSet.size, 401);
  assert.ok(cardB.every((e) => !sentSet.has(key(e))), "カードBの組は送られない");
  // 失敗時も、残りはカードAの組だけ
  const f = await run(cardA, { failOnCall: 2 }); assert.equal(f.ok, false);
  if (!f.ok) assert.ok(f.remaining.every((e) => e.type === "salon" && Number(e.id.slice(-12)) <= 401));
});

test("バッジの判定(画面が使う badgeOutcome): 全件成功のときだけ消す。失敗・例外は消さず再試行表示・未処理分を保持", async () => {
  const ok = badgeOutcome(await run(ents(401))); assert.deepEqual(ok, { clear: true, showRetry: false, remaining: null });
  const input = ents(401);
  for (const plan of [{ failOnCall: 3 }, { failOnCall: 1 }, { throwOnCall: 2 }] as Plan[]) {
    const o = badgeOutcome(await run(input, plan)); assert.equal(o.clear, false, JSON.stringify(plan)); assert.equal(o.showRetry, true); assert.ok(o.remaining && o.remaining.length >= 1);
  }
  const o = badgeOutcome(await run(input, { failOnCall: 2 })); assert.equal(o.remaining?.length, 201, "再試行で送るのは未処理の201件だけ");
});
