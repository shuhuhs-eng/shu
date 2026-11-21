import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveCandidateLoad, CANDIDATE_LOAD_FAILED_MESSAGE, CANDIDATE_EMPTY_MESSAGE } from "../lib/scouts/candidate-load";
import { fetchPublicStylistsForScout } from "../lib/scouts/public-stylists";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const stylist = { stylist_user_id: "00000000-0000-0000-0000-000000000001" };

test("正常0件（error なし・空配列）は成功の0件", () => {
  assert.deepEqual(resolveCandidateLoad({ data: [], error: null }), { ok: true, stylists: [] });
});
test("1人以上は成功。配列の中身・順序はそのまま（並びを変えない）", () => {
  const data = [stylist, { stylist_user_id: "b" }, { stylist_user_id: "a" }];
  const r = resolveCandidateLoad({ data, error: null });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.stylists.map((s) => s.stylist_user_id), data.map((s) => s.stylist_user_id));
});
test("error は失敗（data があっても失敗扱い）", () => {
  assert.deepEqual(resolveCandidateLoad({ data: null, error: { code: "XX000", message: "x" } }), { ok: false });
  assert.deepEqual(resolveCandidateLoad({ data: [stylist], error: { code: "XX000" } }), { ok: false });
});
test("data が配列でないとき（null/undefined/オブジェクト）は失敗。0件と誤認しない", () => {
  for (const data of [null, undefined, {}, "x", 0]) assert.deepEqual(resolveCandidateLoad({ data, error: null }), { ok: false });
});
test("文言: 失敗と0件は別。内部のエラー情報を含まない", () => {
  assert.notEqual(CANDIDATE_LOAD_FAILED_MESSAGE, CANDIDATE_EMPTY_MESSAGE);
  assert.doesNotMatch(CANDIDATE_LOAD_FAILED_MESSAGE, /PGRST|XX000|rpc|error/i);
});

type Call = { fn: string; args?: unknown };
const fakeClient = (script: Array<{ data: unknown; error: unknown }>, calls: Call[]) => ({
  rpc: async (fn: string, args?: unknown) => { calls.push({ fn, args }); return script.shift()!; },
}) as never;

test("フォールバック: PGRST202 のときだけ引数なし版で取り直す（成功）", async () => {
  const calls: Call[] = [];
  const r = await fetchPublicStylistsForScout(fakeClient([{ data: null, error: { code: "PGRST202" } }, { data: [stylist], error: null }], calls), "s1");
  assert.equal(calls.length, 2); assert.deepEqual(calls[1].args, undefined);
  assert.deepEqual(resolveCandidateLoad(r), { ok: true, stylists: [stylist] as never });
});
test("フォールバックも失敗 → 失敗。PGRST202 以外は取り直さない", async () => {
  const c1: Call[] = [];
  assert.deepEqual(resolveCandidateLoad(await fetchPublicStylistsForScout(fakeClient([{ data: null, error: { code: "PGRST202" } }, { data: null, error: { code: "XX000" } }], c1), "s1")), { ok: false });
  const c2: Call[] = [];
  assert.deepEqual(resolveCandidateLoad(await fetchPublicStylistsForScout(fakeClient([{ data: null, error: { code: "XX000" } }], c2), "s1")), { ok: false });
  assert.equal(c2.length, 1);
});

test("画面: 失敗時は role=alert の失敗文言のみ（0件文言と分岐）。失敗時に相性・並べ替えへ進まない構造、他の部分は維持", () => {
  const p = src("app/salon/stores/[storeId]/stylists/page.tsx");
  assert.match(p, /!candidateLoad\.ok \? \([\s\S]*?role="alert"[\s\S]*?CANDIDATE_LOAD_FAILED_MESSAGE[\s\S]*?\) : rankedStylists\.length === 0 \? \([\s\S]*?CANDIDATE_EMPTY_MESSAGE/);
  assert.match(p, /const stylists: PublicStylistForScout\[\] = candidateLoad\.ok \? candidateLoad\.stylists : \[\]/);
  // 維持: スカウト枠・募集停止の案内・並び替え（相性降順→元の順）・取得のフォールバック
  assert.match(p, /<ScoutQuotaCard quota=\{quota\}/); assert.match(p, /RECRUITING_PAUSED_MESSAGE/);
  assert.match(p, /bScore - aScore \|\| a\.originalIndex - b\.originalIndex/);
  assert.match(p, /console\.error\("\[StoreStylistsPage\] get_public_stylists_for_scout failed", \{ message: error\.message, code: error\.code \}\)/);
});
