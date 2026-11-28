import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(p, "utf8");

test("美容師を探す: 地域検索の画面も旧画面も、店舗ダッシュボードと同じ従来の残数カード(ScoutQuotaCard)を使う（台帳方式の部品には依存しない）", () => {
  const p = read("app/salon/stores/[storeId]/stylists/page.tsx");
  assert.ok(!p.includes("ScoutAllowance"));
  assert.equal((p.match(/<ScoutQuotaCard quota=\{/g) ?? []).length, 2);
  assert.ok(!read("app/salon/stores/[storeId]/page.tsx").includes("ScoutAllowance"));
});
test("地域検索の画面: 近隣・全国・地域指定の3つの探し方と、モード・地域コードの受け渡し", () => {
  const a = read("app/salon/stores/[storeId]/stylists/area-candidates.tsx");
  for (const m of ['"near"', '"all"', '"manual"']) assert.ok(a.includes(m));
  assert.ok(a.includes("相性が高い順") && a.includes("fetchScoutCandidatesV2") && a.includes("limit: 20"));
  const page = read("app/salon/stores/[storeId]/stylists/page.tsx");
  assert.ok(page.includes("parseModeParam(sp.mode)") && page.includes("parseCodesParam(sp.codes, 10)") && page.includes("areaSearchV2Enabled()"));
});
test("ページ送り: 続きはカーソルで取得し、条件(店舗・モード・地域)をサーバー側でも検証する。並べ替えはしない", () => {
  const l = read("components/area/candidates-list.tsx"), act = read("lib/area/actions.ts");
  assert.ok(l.includes("loadMoreCandidatesAction") && l.includes("appendPage") && !/\.sort\(/.test(l));
  assert.ok(act.includes("cursor: z.string()") && act.includes("fetchScoutCandidatesV2"));
});
test("入口: 美容師のマイページに希望勤務地、店舗ダッシュボードに所在地へのリンク（どちらも機能フラグ時のみ）", () => {
  const m = read("app/stylist/mypage/page.tsx"), d = read("app/salon/stores/[storeId]/page.tsx");
  assert.ok(/areaSearchV2Enabled\(\) && \([\s\S]*?\/stylist\/preference\/area/.test(m));
  assert.ok(/areaSearchV2Enabled\(\) && \([\s\S]*?\/region`/.test(d));
});
test("希望地域の保存と店舗所在地の確定は、フラグ・認証・入力検証を通す（最終判定はDB）", () => {
  const act = read("lib/area/actions.ts");
  for (const fn of ["saveAreaPreferenceAction", "confirmStoreRegionAction"]) assert.ok(act.includes(`export async function ${fn}`));
  assert.ok((act.match(/areaSearchV2Enabled\(\)/g) ?? []).length >= 4 && (act.match(/auth\.getUser\(\)/g) ?? []).length >= 4);
  assert.ok(act.includes("expectedRevision") && act.includes("expectedFingerprint"));
});
test("フラグで出し分ける地域検索のページは、ビルド時に静的化しない（実行時のフラグ変更が効く）", () => {
  assert.ok(read("app/stylist/preference/area/page.tsx").includes('export const dynamic = "force-dynamic"'));
});

test("地域名の検索: 希望勤務地・地域指定の選択画面と店舗所在地の画面に絞り込み欄があり、別名の照合に regions.ts を使う", () => {
  const picker = read("components/area/region-picker.tsx");
  assert.ok(picker.includes('id="region-search"') && picker.includes("filterRegions(rows, query)"));
  const store = read("components/area/store-region-form.tsx");
  assert.ok(store.includes("matchesRegionQuery(c, cityQuery)") && store.includes("市区町村名で絞り込む"));
  // 選択中の市は絞り込みで消えない
  assert.ok(store.includes("c.code === city ||"));
});
