import test from "node:test";
import assert from "node:assert/strict";
import { buildRegionTree, toggleRegion, todayJst, isRegionValid, regionLabel, filterRegions, matchesRegionQuery, foldRegionText, REGION_NAME_ALIASES, type RegionRow } from "../lib/area/regions";

const row = (o: Partial<RegionRow> & Pick<RegionRow, "code" | "level" | "name">): RegionRow => ({ pref_code: o.code.slice(0, 2), parent_code: null, has_wards: false, valid_from: null, valid_to: null, ...o });
const ROWS: RegionRow[] = [
  row({ code: "13", level: "pref", name: "東京都" }),
  row({ code: "13101", level: "city", name: "千代田区", parent_code: "13" }),
  row({ code: "13102", level: "city", name: "中央区", parent_code: "13" }),
  row({ code: "14", level: "pref", name: "神奈川県" }),
  row({ code: "14100", level: "city", name: "横浜市", parent_code: "14", has_wards: true }),
  row({ code: "14101", level: "ward", name: "鶴見区", parent_code: "14100" }),
  row({ code: "14199", level: "city", name: "旧市", parent_code: "14", valid_to: "2020-03-31" }),
];

// 地域マスターの整形
test("日本時間の今日を返す（UTC 15:00 以降は翌日）", () => {
  assert.equal(todayJst(new Date("2026-11-21T14:59:00Z")), "2026-11-21");
  assert.equal(todayJst(new Date("2026-11-21T15:00:00Z")), "2026-11-22");
});
test("有効期間の境界（開始日・終了日を含む）", () => {
  assert.equal(isRegionValid({ valid_from: "2026-04-01", valid_to: null }, "2026-04-01"), true);
  assert.equal(isRegionValid({ valid_from: "2026-04-01", valid_to: null }, "2026-03-31"), false);
  assert.equal(isRegionValid({ valid_from: null, valid_to: "2020-03-31" }, "2020-03-31"), true);
  assert.equal(isRegionValid({ valid_from: null, valid_to: "2020-03-31" }, "2020-04-01"), false);
});
test("木を作る: 有効なものだけ・コード順・区は市の下", () => {
  const tree = buildRegionTree(ROWS, "2026-11-21");
  assert.deepEqual(tree.map((n) => n.code), ["13", "14"]);
  assert.deepEqual(tree[0].children.map((n) => n.code), ["13101", "13102"]);
  assert.deepEqual(tree[1].children.map((n) => n.code), ["14100"]);
  assert.deepEqual(tree[1].children[0].children.map((n) => n.code), ["14101"]);
});
test("親が無効・存在しない行は木から落とす", () => {
  const orphan = [...ROWS, row({ code: "27100", level: "city", name: "孤児", parent_code: "27" })];
  assert.ok(!(JSON.stringify(buildRegionTree(orphan, "2026-11-21"))).includes("27100"));
});

// 選択の切り替え
test("都道府県を選ぶと、その市区は外れる", () => {
  assert.deepEqual(toggleRegion(["13101", "14"], "13", ROWS, 20).next.sort(), ["13", "14"]);
});
test("市区を選ぶと、その都道府県は外れる", () => {
  assert.deepEqual(toggleRegion(["13"], "13101", ROWS, 20).next, ["13101"]);
});
test("区を選ぶと、市と都道府県は外れる", () => {
  assert.deepEqual(toggleRegion(["14100", "13"], "14101", ROWS, 20).next.sort(), ["13", "14101"]);
});
test("選択済みを押すと外れる", () => {
  assert.deepEqual(toggleRegion(["13", "14"], "13", ROWS, 20).next, ["14"]);
});
test("上限を超える追加は拒否し、選択は変わらない", () => {
  const r = toggleRegion(["13101", "13102"], "14", ROWS, 2);
  assert.equal(r.error, "too_many"); assert.deepEqual(r.next, ["13101", "13102"]);
});
test("重なりを外した結果が上限以内なら追加できる", () => {
  assert.deepEqual(toggleRegion(["13101", "13102"], "13", ROWS, 1).next, ["13"]);
});
test("表示名は県名と市名を含む", () => {
  assert.equal(regionLabel("13101", ROWS), "東京都 千代田区");
  assert.equal(regionLabel("13", ROWS), "東京都");
  assert.equal(regionLabel("zz", ROWS), "zz");
});

// 地域名の検索（39405: 表示は「梼原町」・「檮原町」でも当たる）
test("地域名の検索: 表示名は梼原町のまま、檮原町・梼原でも檮原でも当たる", () => {
  const rows: RegionRow[] = [
    ...ROWS,
    row({ code: "39", level: "pref", name: "高知県" }),
    row({ code: "39405", level: "city", name: "梼原町", parent_code: "39" }),
    row({ code: "39402", level: "city", name: "佐川町", parent_code: "39" }),
  ];
  for (const q of ["梼原町", "檮原町", "梼原", "檮原", " 檮 原 ", "梼"]) assert.deepEqual(filterRegions(rows, q).map((r) => r.code), ["39405"], q);
  assert.equal(rows.find((r) => r.code === "39405")?.name, "梼原町");        // 表示名は変えない
  assert.deepEqual(REGION_NAME_ALIASES["39405"], ["檮原町"]);
  assert.deepEqual(filterRegions(rows, "町").map((r) => r.code), ["39402", "39405"]);
});
test("地域名の検索: 空の検索語は何も返さない・全角半角と空白は無視・区も市名で絞れる", () => {
  assert.equal(matchesRegionQuery({ code: "13101", name: "千代田区" }, ""), false);
  assert.equal(matchesRegionQuery({ code: "13101", name: "千代田区" }, "   "), false);
  assert.equal(foldRegionText("　檮 原町"), "梼原町");
  assert.deepEqual(filterRegions(ROWS, "鶴見").map((r) => r.code), ["14101"]);
  assert.equal(filterRegions(ROWS, "存在しない").length, 0);
  assert.equal(filterRegions(ROWS, "区", 1).length, 1);   // limit
});
