import test from "node:test";
import assert from "node:assert/strict";
import { areaSearchV2Enabled } from "../lib/area/feature-flag";
import { parseCodesParam, parseModeParam } from "../lib/area/query-params";
import { toMatchResult, fetchStoresForStylistV2, fetchMyAreaPreference, saveMyAreaPreference, fetchStoreRegion } from "../lib/area/area-search";

test("機能フラグは AREA_SEARCH_V2=1 のときだけ有効（既定オフ・他の値は無効）", () => {
  assert.equal(areaSearchV2Enabled({}), false);
  for (const v of ["0", "true", "yes", "", " 1", "1 "]) assert.equal(areaSearchV2Enabled({ AREA_SEARCH_V2: v }), false, v);
  assert.equal(areaSearchV2Enabled({ AREA_SEARCH_V2: "1" }), true);
});

test("クエリのモードは near/all/manual 以外なら near に落とす", () => {
  assert.equal(parseModeParam("all"), "all"); assert.equal(parseModeParam("manual"), "manual");
  for (const v of [undefined, "", "ALL", "x", "near; drop table"]) assert.equal(parseModeParam(v), "near");
  assert.equal(parseModeParam(["all", "manual"]), "all");
});

test("クエリの地域コードは形式が正しいものだけ・重複除去・上限で切る", () => {
  assert.deepEqual(parseCodesParam("13,13101,13101", 10), ["13", "13101"]);
  assert.deepEqual(parseCodesParam("13, 1310, abc,'13'; --,14101", 10), ["13", "14101"]);
  assert.deepEqual(parseCodesParam(undefined, 10), []);
  assert.deepEqual(parseCodesParam("01,02,03", 2), ["01", "02"]);
});

test("相性の整形: 計算できるものはそのまま・形が想定外なら『計算できない』・無いときは null", () => {
  assert.deepEqual(toMatchResult({ available: true, overall_score: 80, axis_scores: { education: 1 } }), { available: true, overall_score: 80, axis_scores: { education: 1 } });
  assert.deepEqual(toMatchResult({ available: false, reason: "x" }), { available: false, reason: "x" });
  assert.deepEqual(toMatchResult({ available: true }), { available: false, reason: "unknown" });
  assert.equal(toMatchResult(null), null); assert.equal(toMatchResult("x"), null);
});

const rpcOk = (data: unknown) => ({ rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data, error: null }; } });
const rpcErr = (message: string) => ({ rpc: async () => ({ data: null, error: { message } }) });
const calls: { fn: string; args: Record<string, unknown> }[] = [];

test("店舗一覧v2: manual のときだけ地域コードを送る・失敗は利用者向け文言", async () => {
  calls.length = 0;
  const page = { items: [], next_cursor: null, mode: "near", my_area_mode: "unset", counts: { main: 0, unconfirmed: 0, total: 0 }, active_version: "v1" };
  const r = await fetchStoresForStylistV2(rpcOk(page), { mode: "near", regionCodes: ["13"] }); assert.equal(r.ok, true);
  assert.equal(calls[0].args.p_region_codes, null);
  await fetchStoresForStylistV2(rpcOk(page), { mode: "manual", regionCodes: ["13"] }); assert.deepEqual(calls[1].args.p_region_codes, ["13"]);
  const bad = await fetchStoresForStylistV2(rpcErr("invalid_cursor"), { mode: "near", cursor: "x" });
  assert.equal(bad.ok, false); if (!bad.ok) assert.match(bad.message, /最初から読み込み直しました/);
  const shape = await fetchStoresForStylistV2(rpcOk({ items: "x" }), { mode: "near" }); assert.equal(shape.ok, false);
});

test("希望勤務地: 取得・保存。selected 以外はコードを送らない・競合は conflict で返る", async () => {
  calls.length = 0;
  const g = await fetchMyAreaPreference(rpcOk({ mode: "unset", revision: 0, items: [] })); assert.equal(g.ok, true);
  await saveMyAreaPreference(rpcOk({ revision: 3 }), { mode: "nationwide", codes: ["13"], expectedRevision: 2 });
  assert.deepEqual(calls[1].args, { p_mode: "nationwide", p_codes: [], p_expected_revision: 2 });
  const ok = await saveMyAreaPreference(rpcOk({ revision: 3 }), { mode: "selected", codes: ["13"], expectedRevision: 2 });
  assert.deepEqual(ok, { ok: true, revision: 3 });
  const c = await saveMyAreaPreference(rpcErr("area_preference_revision_conflict"), { mode: "selected", codes: ["13"], expectedRevision: 1 });
  assert.equal(c.ok, false); if (!c.ok) { assert.equal(c.conflict, true); assert.match(c.message, /読み込み直してから/); }
  const odd = await saveMyAreaPreference(rpcOk({}), { mode: "unset", codes: [], expectedRevision: 0 }); assert.equal(odd.ok, false);
});

test("店舗の所在地の取得: 失敗は文言・未登録は null", async () => {
  const r = await fetchStoreRegion(rpcOk(null), "s"); assert.deepEqual(r, { ok: true, region: null });
  const e = await fetchStoreRegion(rpcErr("insufficient permission"), "s"); assert.equal(e.ok, false);
});
