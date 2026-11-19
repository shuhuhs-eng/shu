// 店舗への希望（見学／体験入店）: 種別ごとの送信・取消、旧DB（0095前）互換、停止中の扱い。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

type Call = { name: string; args: Record<string, unknown> };
type Err = { code?: string; message: string } | null;
const env: { calls: Call[]; errFor: Record<string, Err>; revalidated: string[] } = { calls: [], errFor: {}, revalidated: [] };
const fake = {
  rpc: async (name: string, args: Record<string, unknown>) => { env.calls.push({ name, args }); return { data: null, error: env.errFor[name] ?? null }; },
};
const orig = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  if (request === "next/navigation") return { useRouter: () => ({ refresh() {} }) };
  if (request === "next/cache") return { revalidatePath: (p: string) => env.revalidated.push(p) };
  if (request === "@/lib/supabase/server") return { createClient: async () => fake };
  return orig.call(this, request, ...rest);
};
after(() => { (Module as unknown as { _load: unknown })._load = orig; });
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setStoreInterestAction } = require("../lib/interests/actions");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const K = require("../lib/interests/kinds");
const reset = () => { env.calls = []; env.errFor = {}; env.revalidated = []; };
const S = "11111111-1111-4111-8111-111111111111";
const MISSING = { code: "PGRST202", message: "Could not find the function public.set_store_interest_v2" };

test("見学・体験入店とも v2 を種別つきで1回だけ呼ぶ（送信・取消）", async () => {
  for (const kind of ["visit", "trial"]) for (const on of [true, false]) {
    reset();
    const r = await setStoreInterestAction(S, kind, on);
    assert.deepEqual(r, { success: true });
    assert.deepEqual(env.calls, [{ name: "set_store_interest_v2", args: { p_store_id: S, p_kind: kind, p_interested: on } }]);
  }
});
test("不正な種別・店舗IDはDBへ呼ばない", async () => {
  for (const [id, kind] of [[S, "other"], [S, undefined], ["x", "visit"]]) {
    reset();
    const r = await setStoreInterestAction(id as string, kind as never, true);
    assert.equal(r.success, false);
    assert.equal(env.calls.length, 0);
  }
});
test("DB未適用: 見学は旧RPCで送信・取消できる", async () => {
  for (const on of [true, false]) {
    reset(); env.errFor.set_store_interest_v2 = MISSING;
    const r = await setStoreInterestAction(S, "visit", on);
    assert.deepEqual(r, { success: true });
    assert.deepEqual(env.calls.map((c) => c.name), ["set_store_interest_v2", "set_store_interest"]);
    assert.deepEqual(env.calls[1].args, { p_store_id: S, p_interested: on });
  }
});
test("DB未適用: 体験入店は旧RPCへ読み替えず（見学として保存しない）準備中を返す", async () => {
  reset(); env.errFor.set_store_interest_v2 = MISSING;
  const r = await setStoreInterestAction(S, "trial", true);
  assert.equal(r.success, false);
  assert.deepEqual(env.calls.map((c) => c.name), ["set_store_interest_v2"]);
});
test("停止中店舗への新規送信は専用メッセージ（見学・体験入店とも）。生のエラーは出さない", async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { RECRUITING_PAUSED_MESSAGE } = require("../lib/contracts/recruiting-access");
  for (const kind of ["visit", "trial"]) {
    reset(); env.errFor.set_store_interest_v2 = { message: "recruiting is paused for this organization" };
    const r = await setStoreInterestAction(S, kind, true);
    assert.deepEqual(r, { success: false, error: RECRUITING_PAUSED_MESSAGE });
  }
});
test("kinds: kind列なし（旧DB・旧RPC）は見学扱い。体験入店へは読み替えない", () => {
  assert.deepEqual(K.interestedKinds([{}]), { visit: true, trial: false });
  assert.deepEqual(K.interestedKinds([{ kind: "trial" }]), { visit: false, trial: true });
  assert.deepEqual(K.interestedKinds([{ kind: "visit" }, { kind: "trial" }]), { visit: true, trial: true });
  assert.deepEqual(K.interestedKinds([]), { visit: false, trial: false });
  assert.deepEqual(K.interestedKinds(null), { visit: false, trial: false });
  assert.equal(K.normalizeInterestKind(undefined), "visit");
  assert.equal(K.isMissingColumnError({ code: "42703", message: "column stylist_salon_interests.kind does not exist" }), true);
  assert.equal(K.isMissingColumnError({ code: "42501", message: "denied" }), false);
});

// ---- 取得経路・状態不明・ボタン操作 ----
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadOwnInterestState } = require("../lib/interests/load");
const mkClient = (results: Array<{ data: unknown; error: { code?: string; message?: string } | null } | "throw">) => {
  const seen: string[] = [];
  return {
    seen,
    from: () => ({ select: (cols: string) => ({ eq: () => ({ eq: async () => {
      seen.push(cols);
      const r = results.shift();
      if (r === "throw" || r === undefined) throw new Error("boom");
      return r;
    } }) }) }),
  };
};
test("状態取得: kindあり → 両種別・片方だけを正しく返す", async () => {
  const c = mkClient([{ data: [{ id: "1", kind: "visit" }, { id: "2", kind: "trial" }], error: null }]);
  assert.deepEqual(await loadOwnInterestState(c, "u", "s"), { status: "known", kinds: { visit: true, trial: true } });
  const c2 = mkClient([{ data: [{ id: "2", kind: "trial" }], error: null }]);
  assert.deepEqual(await loadOwnInterestState(c2, "u", "s"), { status: "known", kinds: { visit: false, trial: true } });
  const c3 = mkClient([{ data: [], error: null }]);
  assert.deepEqual(await loadOwnInterestState(c3, "u", "s"), { status: "known", kinds: { visit: false, trial: false } });
});
test("状態取得: 旧DB（kind列なし）は旧select再取得し、行があれば見学", async () => {
  const c = mkClient([{ data: null, error: { code: "42703", message: 'column stylist_salon_interests.kind does not exist' } }, { data: [{ id: "1" }], error: null }]);
  assert.deepEqual(await loadOwnInterestState(c, "u", "s"), { status: "known", kinds: { visit: true, trial: false } });
  assert.deepEqual(c.seen, ["id, kind", "id"]);
});
test("状態取得: 取得失敗は未送信にせず unknown（通常の失敗・旧DB切替後の再取得失敗・例外・想定外の形）", async () => {
  assert.deepEqual(await loadOwnInterestState(mkClient([{ data: null, error: { code: "57014", message: "timeout" } }]), "u", "s"), { status: "unknown" });
  assert.deepEqual(await loadOwnInterestState(mkClient([{ data: null, error: { code: "42703", message: "column kind does not exist" } }, { data: null, error: { message: "denied" } }]), "u", "s"), { status: "unknown" });
  assert.deepEqual(await loadOwnInterestState(mkClient(["throw"]), "u", "s"), { status: "unknown" });
  assert.deepEqual(await loadOwnInterestState(mkClient([{ data: { not: "array" }, error: null }]), "u", "s"), { status: "unknown" });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { StoreInterestButton } = require("../components/stylist-salons/store-interest-button");
const html = (state: unknown) =>  renderToStaticMarkup(createElement(StoreInterestButton, { storeId: S, interestState: state }));
const dis = (b: string) => / disabled=""/.test(b);
const btn = (h: string, kind: string, role: string) => (h.match(new RegExp(`<button[^>]*data-kind="${kind}"[^>]*data-role="${role}"[^>]*>`)) ?? [""])[0];
test("ボタン: 未送信は2つの送信ボタンが有効、取消ボタンなし", () => {
  const h = html({ status: "known", kinds: { visit: false, trial: false } });
  assert.ok(h.includes("見学を希望する") && h.includes("体験入店を希望する"));
  assert.ok(!dis(btn(h, "visit", "send")) && !dis(btn(h, "trial", "send")));
  assert.ok(!h.includes('data-role="cancel"') && !h.includes("interest-unknown"));
});
test("ボタン: 送信済みの主ボタンは無効（取消を実行しない）。取消は明示ボタンだけ。もう片方は影響なし", () => {
  const h = html({ status: "known", kinds: { visit: true, trial: false } });
  assert.ok(dis(btn(h, "visit", "send")));
  assert.ok(h.includes("見学を希望するを送信済み") && h.includes("見学の希望を取り消す"));
  assert.ok(!dis(btn(h, "visit", "cancel")));
  assert.ok(!dis(btn(h, "trial", "send")) && !h.includes("体験入店の希望を取り消す"));
});
test("ボタン: 状態不明は未送信と表示せず、送信・取消の全ボタンを止める", () => {
  const h = html({ status: "unknown" });
  assert.ok(h.includes("interest-unknown") && h.includes("送信状況を確認できません"));
  assert.ok(!h.includes(">見学を希望する<") && !h.includes(">体験入店を希望する<"));
  assert.ok(dis(btn(h, "visit", "send")) && dis(btn(h, "trial", "send")));
  assert.ok(!h.includes('data-role="cancel"'));
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isInterestList } = require("../lib/admin/operations");
test("取得経路: 運営一覧の検証は kind（visit/trial/なし）を通し、不正な値は拒否", () => {
  const row = (kind?: unknown) => ({ interest_id: "i", created_at: "t", stylist_user_id: "s", store_id: "x", progress_state: "not_created", ...(kind === undefined ? {} : { kind }) });
  const wrap = (r: unknown) => ({ total: 1, legacy_rows_without_store: 0, rows: [r] });
  assert.ok(isInterestList(wrap(row("visit"))) && isInterestList(wrap(row("trial"))) && isInterestList(wrap(row())));
  assert.ok(!isInterestList(wrap(row("other"))));
});
test("店舗側: 同じ美容師の見学・体験入店は1枚にまとめ、片方だけなら片方だけ（旧RPCのkind無しは見学）", () => {
  const rows = [
    { stylist_user_id: "a", kind: "trial", created_at: "2" },
    { stylist_user_id: "b", created_at: "3" },
    { stylist_user_id: "a", kind: "visit", created_at: "1" },
  ];
  const g = K.groupInterestsByStylist(rows);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].kinds, [{ kind: "visit", created_at: "1" }, { kind: "trial", created_at: "2" }]);
  assert.deepEqual(g[1].kinds, [{ kind: "visit", created_at: "3" }]);
  const after = K.groupInterestsByStylist(rows.filter((r) => r.kind !== "visit" || r.stylist_user_id !== "a"));
  assert.deepEqual(after[0].kinds, [{ kind: "trial", created_at: "2" }]);
});
