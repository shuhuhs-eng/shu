import test from "node:test";
import assert from "node:assert/strict";
import { confirmStoreRegion, areaErrorMessage, appendPage, conditionKey, emptyPager, fetchScoutCandidatesV2, nearEmptyMessage, AREA_BADGE_LABEL } from "../lib/area/area-search";

test("DBの競合・住所変更・権限エラーが利用者向け文言に変わる（内部名を出さない）", () => {
  for (const m of ["area_preference_revision_conflict", "address_changed", "insufficient permission to manage store hiring", "ward_required", "overlapping_codes", "invalid_cursor"]) {
    const t = areaErrorMessage(m);
    assert.ok(!/[a-z_]{8,}/.test(t), t);
  }
  assert.match(areaErrorMessage("boom"), /もう一度/);
  assert.match(areaErrorMessage(undefined), /もう一度/);
});
test("近隣0件の文言は『美容師がいない』と言わず、全国への導線と未設定の案内を含む", () => {
  const t = nearEmptyMessage();
  assert.ok(!t.includes("美容師はいません") && !t.includes("美容師がいません"));
  assert.match(t, /全国/); assert.match(t, /設定していない/);
});
test("バッジ文言: 詳細未確認は『一致』と表示しない", () => {
  assert.equal(AREA_BADGE_LABEL.unconfirmed, "詳細未確認");
  assert.ok(!AREA_BADGE_LABEL.unconfirmed.includes("一致"));
});
test("ページ追加: 同じ条件なら重複を除いて追記、条件が変われば捨てる", () => {
  const k1 = conditionKey("s", "near"), k2 = conditionKey("s", "manual", ["14", "13"]);
  assert.equal(conditionKey("s", "manual", ["13", "14"]), k2, "コード順に依存しない");
  let st = emptyPager<{ stylist_user_id: string }>(k1);
  st = appendPage(st, k1, { items: [{ stylist_user_id: "a" }, { stylist_user_id: "b" }], next_cursor: "c1" });
  st = appendPage(st, k1, { items: [{ stylist_user_id: "b" }, { stylist_user_id: "c" }], next_cursor: null });
  assert.deepEqual(st.items.map((i) => i.stylist_user_id), ["a", "b", "c"]); assert.equal(st.exhausted, true);
  st = appendPage(st, k2, { items: [{ stylist_user_id: "z" }], next_cursor: "c9" });
  assert.deepEqual(st.items.map((i) => i.stylist_user_id), ["z"]); assert.equal(st.nextCursor, "c9");
});
test("RPC呼び出し: 近隣では地域コードを渡さない/手動では渡す・失敗は文言つきで返す", async () => {
  const calls: Record<string, unknown>[] = [];
  const mk = (res: { data: unknown; error: { message?: string } | null }) => ({ rpc: (fn: string, a: Record<string, unknown>) => { calls.push({ fn, ...a }); return Promise.resolve(res); } });
  const page = { items: [], next_cursor: null, mode: "near", counts: { main: 0, unconfirmed: 0, total: 0 }, store_region: {}, active_version: "v" };
  const r1 = await fetchScoutCandidatesV2(mk({ data: page, error: null }), { storeId: "s", mode: "near", regionCodes: ["13"] });
  assert.equal(r1.ok, true); assert.equal(calls[0].p_region_codes, null); assert.equal(calls[0].fn, "get_scout_candidates_v2");
  await fetchScoutCandidatesV2(mk({ data: page, error: null }), { storeId: "s", mode: "manual", regionCodes: ["13"] });
  assert.deepEqual(calls[1].p_region_codes, ["13"]);
  const r3 = await fetchScoutCandidatesV2(mk({ data: null, error: { message: "invalid_cursor" } }), { storeId: "s", mode: "all" });
  assert.deepEqual(r3, { ok: false, message: areaErrorMessage("invalid_cursor") });
  const r4 = await fetchScoutCandidatesV2(mk({ data: { nope: 1 }, error: null }), { storeId: "s", mode: "all" });
  assert.equal(r4.ok, false);
});

test("所在地の確定: 住所の指紋と所在地リビジョンを必ず送る・競合は利用者向け文言", async () => {
  const calls: Record<string, unknown>[] = [];
  const mk = (error: { message?: string } | null) => ({ rpc: (fn: string, a: Record<string, unknown>) => { calls.push({ fn, ...a }); return Promise.resolve({ data: null, error }); } });
  const r = await confirmStoreRegion(mk(null), { storeId: "s", cityCode: "13101", expectedFingerprint: "fp", expectedRevision: 0 });
  assert.equal(r.ok, true);
  assert.deepEqual(calls[0], { fn: "confirm_store_region", p_store_id: "s", p_city_code: "13101", p_ward_code: null, p_expected_fingerprint: "fp", p_expected_revision: 0 });
  const r2 = await confirmStoreRegion(mk({ message: "store_region_revision_conflict" }), { storeId: "s", cityCode: "13101", expectedFingerprint: "fp", expectedRevision: 1 });
  assert.deepEqual(r2, { ok: false, message: areaErrorMessage("store_region_revision_conflict") });
  assert.match(areaErrorMessage("store_region_revision_conflict"), /別の担当者/);
});
