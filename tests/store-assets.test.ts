import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hasAnyStoreAsset, isStoreAssetsUnavailable, mapStoreAssetError, nextFreeSortOrder, parseStoreAssetsJson } from "../lib/store-assets/parse";
import { loadStoreAssets } from "../lib/store-assets/load";
import { StoreAssetsSection } from "../components/store-assets/store-assets-section";
import { StoreDetailView } from "../components/stylist-salons/store-detail-view";
import { STORE_ASSET_SIGNED_URL_EXPIRES_IN } from "../lib/store-assets/constants";

const S = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const strip = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");

const json = (over: Record<string, unknown> = {}) => ({
  store_id: S,
  logo_path: `${S}/logo/a.webp`,
  photos: [{ id: "p1", category: "interior", storage_path: `${S}/interior/1.webp`, sort_order: 0 }],
  links: [{ id: "l1", link_type: "website", label: "公式", url: "https://example.test/", sort_order: 0 }],
  ...over,
});

test("parse: 要求した店舗と一致する内容だけ受け取る（別店舗の内容は捨てる）", () => {
  assert.ok(parseStoreAssetsJson(json(), S));
  assert.equal(parseStoreAssetsJson(json({ store_id: OTHER }), S), null);
  assert.equal(parseStoreAssetsJson(null, S), null);
});
test("parse: 他店舗のパス・https以外のURL・不明な種別は画面に出さない", () => {
  const r = parseStoreAssetsJson(
    json({
      logo_path: `${OTHER}/logo/x.webp`,
      photos: [{ id: "p", category: "interior", storage_path: `${OTHER}/interior/x.webp`, sort_order: 0 }, { id: "q", category: "bad", storage_path: `${S}/bad/x.webp`, sort_order: 0 }],
      links: [{ id: "a", link_type: "website", url: "http://insecure.test/", sort_order: 0 }, { id: "b", link_type: "evil", url: "https://x.test/", sort_order: 1 }],
    }),
    S,
  )!;
  assert.equal(r.logoPath, null);
  assert.equal(r.photos.length, 0);
  assert.equal(r.links.length, 0);
});
test("0081 未適用の判定・並び順・エラー文言", () => {
  assert.equal(isStoreAssetsUnavailable({ code: "PGRST202" }), true);
  assert.equal(isStoreAssetsUnavailable({ code: "42883" }), true);
  assert.equal(isStoreAssetsUnavailable({ code: "42501", message: "permission denied" }), false);
  assert.equal(isStoreAssetsUnavailable(null), false);
  assert.equal(nextFreeSortOrder([0, 2], 3), 1);
  assert.equal(nextFreeSortOrder([0, 1, 2], 3), null);
  assert.match(mapStoreAssetError("store not found or not editable"), /閲覧のみ/);
  assert.doesNotMatch(mapStoreAssetError("ERROR: some internal detail xyz"), /xyz/);
});
test("署名付きURLの有効期限は300秒（1時間より短い）", () => {
  assert.equal(STORE_ASSET_SIGNED_URL_EXPIRES_IN, 300);
});

const fakeSupabase = (rpcResult: { data: unknown; error: unknown }, calls: string[]) =>
  ({
    rpc: async (name: string) => { calls.push(`rpc:${name}`); return rpcResult; },
    storage: { from: () => ({ createSignedUrls: async (paths: string[]) => { calls.push(`sign:${paths.length}`); return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed.test/${p}` })), error: null }; } }) },
  }) as never;

test("load: 美容師向けは get_public_store_assets、担当者・プレビューは get_store_assets を呼ぶ", async () => {
  const calls: string[] = [];
  const r = await loadStoreAssets(fakeSupabase({ data: json(), error: null }, calls), S, "stylist");
  assert.equal(r.status, "ok");
  assert.deepEqual(calls, ["rpc:get_public_store_assets", "sign:2"]);
  const calls2: string[] = [];
  await loadStoreAssets(fakeSupabase({ data: json(), error: null }, calls2), S, "staff");
  assert.equal(calls2[0], "rpc:get_store_assets");
});
test("load: 0081 未適用は unavailable（エラーにしない）／取得失敗は error／形が違えば error", async () => {
  const c: string[] = [];
  assert.equal((await loadStoreAssets(fakeSupabase({ data: null, error: { code: "PGRST202", message: "x" } }, c), S, "staff")).status, "unavailable");
  assert.equal((await loadStoreAssets(fakeSupabase({ data: null, error: { code: "57014", message: "timeout" } }, c), S, "staff")).status, "error");
  assert.equal((await loadStoreAssets(fakeSupabase({ data: { store_id: OTHER }, error: null }, c), S, "staff")).status, "error");
});
test("load: 画像が無ければ署名付きURLを発行しない", async () => {
  const calls: string[] = [];
  const r = await loadStoreAssets(fakeSupabase({ data: json({ logo_path: null, photos: [] }), error: null }, calls), S, "stylist");
  assert.equal(r.status, "ok");
  assert.deepEqual(calls, ["rpc:get_public_store_assets"]);
});

const assets = {
  storeId: S, logoPath: `${S}/logo/a.webp`, logoUrl: "https://signed.test/logo",
  photos: [{ id: "p1", category: "interior" as const, storagePath: `${S}/interior/1.webp`, sortOrder: 0, url: "https://signed.test/p1" }, { id: "p2", category: "atmosphere" as const, storagePath: `${S}/atmosphere/1.webp`, sortOrder: 0, url: null }],
  links: [{ id: "l1", linkType: "hotpepper" as const, label: null, url: "https://beauty.hotpepper.jp/slnH1/", sortOrder: 0 }],
};
test("表示: 登録があれば店舗別のロゴ・写真・リンクを表示する／署名URLが無い写真は出さない／空なら何も出さない", () => {
  const html = renderToStaticMarkup(createElement(StoreAssetsSection, { assets }));
  assert.match(html, /signed\.test\/logo/);
  assert.match(html, /signed\.test\/p1/);
  assert.doesNotMatch(html, /スタッフ・サロンの雰囲気/); // 取得できなかった写真しか無いグループは出さない
  assert.match(html, /HOTPEPPER Beauty/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.equal(renderToStaticMarkup(createElement(StoreAssetsSection, { assets: null })), "");
  assert.equal(renderToStaticMarkup(createElement(StoreAssetsSection, { assets: { ...assets, logoPath: null, logoUrl: null, photos: [], links: [] } })), "");
  assert.equal(hasAnyStoreAsset(null), false);
});
test("店舗詳細: assets を渡さなければ従来どおり（アカウント共通の画像・リンクは表示しない）", () => {
  const base = { store_name: "店", prefecture: "東京都", city: null, street_address: null, culture_description: null, employee_size_code: null, target_specialties: [], bio: null, hotpepper_url: null, culture: null } as never;
  const without = renderToStaticMarkup(createElement(StoreDetailView, { store: base, employeeSizeLabel: null, matchSection: null }));
  assert.doesNotMatch(without, /signed\.test/);
  const withAssets = renderToStaticMarkup(createElement(StoreDetailView, { store: base, employeeSizeLabel: null, matchSection: null, assets }));
  assert.match(withAssets, /signed\.test\/p1/);
});

test("静的確認: 画面は店舗別の取得・保存だけを使い、アカウント共通の取得処理を直接呼ばない／保存は店舗IDを渡す", () => {
  const view = strip("components/store-assets/store-assets-section.tsx");
  assert.doesNotMatch(view, /salon_photos|salon_links|avatar_path|salon-photos/);
  const actions = strip("lib/store-assets/actions.ts");
  assert.doesNotMatch(actions, /salon_photos|salon_links|"avatars"|"salon-photos"/);
  for (const fn of ["set_store_logo", "add_store_photo", "delete_store_photo", "add_store_link", "delete_store_link"]) assert.match(actions, new RegExp(fn));
  const editor = strip("components/store-assets/store-assets-editor.tsx");
  assert.match(editor, /\$\{storeId\}\/\$\{category\}\//); // アップロード先は {storeId}/{category}/…
  assert.match(editor, /cacheControl: STORE_ASSET_CACHE_CONTROL/);
  const page = strip("app/salon/stores/[storeId]/profile/page.tsx");
  assert.match(page, /canManageStoreHiringHint/);
  assert.match(page, /canManage \?/); // 閲覧のみにはフォームを出さない
  const stylist = strip("app/stylist/salons/[storeId]/page.tsx");
  assert.match(stylist, /loadStoreAssets\(supabase, store\.store_id, "stylist"\)/);
  const preview = strip("app/salon/stores/[storeId]/preview/page.tsx");
  assert.match(preview, /loadStoreAssets\(supabase, storeId, "staff"\)/);
});
