import test from "node:test";
import assert from "node:assert/strict";
import { fetchAllPaged, type PageResult } from "../lib/area/paging";
import { buildRegionTree, toggleRegion, type RegionRow } from "../lib/area/regions";

// 47都道府県 + 市区町村を合計 N 件に水増しした地域マスター（コード昇順）
function makeRows(n: number): RegionRow[] {
  const rows: RegionRow[] = [];
  for (let p = 1; p <= 47; p++) rows.push({ code: String(p).padStart(2, "0"), level: "pref", pref_code: String(p).padStart(2, "0"), parent_code: null, name: `県${p}`, has_wards: false, valid_from: null, valid_to: null });
  let i = 0;
  while (rows.length < n) {
    const p = (i % 47) + 1;
    rows.push({ code: `${String(p).padStart(2, "0")}${String(100 + Math.floor(i / 47)).padStart(3, "0")}`, level: "city", pref_code: String(p).padStart(2, "0"), parent_code: String(p).padStart(2, "0"), name: `市${i}`, has_wards: false, valid_from: null, valid_to: null });
    i++;
  }
  return rows.sort((a, b) => (a.code < b.code ? -1 : 1));
}
// APIの最大行数(maxRows)で打ち切るモック
const server = (all: RegionRow[], o: { maxRows?: number; failAtCall?: number; throwAtCall?: number; lieCount?: number; emptyAfter?: number; changeCountAtCall?: number } = {}) => {
  let calls = 0;
  const f = async (from: number, to: number): Promise<PageResult<RegionRow>> => {
    calls++;
    if (o.throwAtCall === calls) throw new Error("network");
    if (o.failAtCall === calls) return { data: null, error: { message: "boom" } };
    const cap = o.maxRows ?? Infinity;
    let slice = all.slice(from, Math.min(to + 1, from + cap));
    if (o.emptyAfter !== undefined && from >= o.emptyAfter) slice = [];
    const count = o.changeCountAtCall === calls ? all.length + 1 : (o.lieCount ?? all.length);
    return { data: slice, error: null, count };
  };
  return { f, calls: () => calls };
};

test("1,000件を超えても末尾の地域まで取得でき、選択できる", async () => {
  const all = makeRows(2600);
  const s = server(all, { maxRows: 1000 });
  const got = await fetchAllPaged(s.f, { pageSize: 1000, keyOf: (r) => r.code });
  assert.ok(got);
  assert.equal(got!.length, 2600);
  assert.equal(s.calls(), 3);
  const last = all[all.length - 1];
  assert.equal(got![got!.length - 1].code, last.code);
  const tree = buildRegionTree(got!, "2026-11-21");
  const pref = tree.find((n) => n.code === last.pref_code)!;
  assert.ok(pref.children.some((c) => c.code === last.code), "末尾の市区が木に出る");
  const r = toggleRegion([], last.code, got!, 20);
  assert.deepEqual(r.next, [last.code]);
  assert.equal(r.error, null);
});
test("単純なrange(maxRowsなし)でも全件", async () => {
  const all = makeRows(1000);
  assert.equal((await fetchAllPaged(server(all).f, { pageSize: 1000 }))!.length, 1000);
  const all2 = makeRows(1001);
  assert.equal((await fetchAllPaged(server(all2).f, { pageSize: 1000 }))!.length, 1001);
});
test("サーバー最大行数が小さい(500)でも打ち切りを欠落にせず続行する", async () => {
  const all = makeRows(1800);
  const got = await fetchAllPaged(server(all, { maxRows: 500 }).f, { pageSize: 1000, keyOf: (r) => r.code });
  assert.equal(got!.length, 1800);
});
test("途中のページ失敗は null（一部だけを全件として返さない）", async () => {
  assert.equal(await fetchAllPaged(server(makeRows(2600), { failAtCall: 2 }).f), null);
  assert.equal(await fetchAllPaged(server(makeRows(2600), { throwAtCall: 3 }).f), null);
  assert.equal(await fetchAllPaged(server(makeRows(2600), { failAtCall: 1 }).f), null);
});
test("件数に達しないまま空ページが返ったら null", async () => {
  assert.equal(await fetchAllPaged(server(makeRows(2600), { emptyAfter: 1000 }).f), null);
});
test("取得中に件数が変わったら null", async () => {
  assert.equal(await fetchAllPaged(server(makeRows(2600), { changeCountAtCall: 2 }).f), null);
});
test("件数が取れない(count未返却)なら null", async () => {
  const f = async () => ({ data: makeRows(10), error: null }) as PageResult<RegionRow>;
  assert.equal(await fetchAllPaged(f), null);
});
test("コード重複(並び不安定の兆候)は null", async () => {
  const all = makeRows(30);
  all[10] = { ...all[9] };
  assert.equal(await fetchAllPaged(server(all).f, { keyOf: (r) => r.code }), null);
});
test("0件は成功(空配列)として扱う", async () => {
  assert.deepEqual(await fetchAllPaged(server([]).f), []);
});
test("上限を超える件数は null", async () => {
  assert.equal(await fetchAllPaged(server(makeRows(60), { lieCount: 500_000 }).f, { maxRows: 1000 }), null);
});
