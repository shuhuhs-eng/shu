import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hasAnyStoreAsset, isStoreAssetsUnavailable, mapStoreAssetError, nextFreeSortOrder, parseStoreAssetsJson } from "../lib/store-assets/parse";
import { addStorePhoto, replaceStorePhoto, setStoreLogo, deleteStorePhoto, type StoreAssetDeps, type RpcError } from "../lib/store-assets/service";
import { loadStoreAssets } from "../lib/store-assets/load";
import { StoreAssetsSection } from "../components/store-assets/store-assets-section";
import { StoreDetailView } from "../components/stylist-salons/store-detail-view";
import { STORE_ASSET_SIGNED_URL_EXPIRES_IN, STORE_PHOTO_FRAME_CLASS, STORE_PHOTO_GRID_CLASS, STORE_PHOTO_IMAGE_CLASS, STORE_PHOTO_MAX } from "../lib/store-assets/constants";

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
  assert.match(mapStoreAssetError("store already has the maximum of 8 photos"), /最大8枚/);
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
  assert.doesNotMatch(html, /signed\.test\/logo/); // ロゴは写真の一覧に含めない（店名の左に小さく表示する）
  assert.match(html, /signed\.test\/p1/);
  assert.match(html, />店舗の写真</);
  assert.doesNotMatch(html, /スタッフ・サロンの雰囲気|店内の様子|内装写真/); // 分類名は出さない
  assert.equal((html.match(/<img/g) ?? []).length, 1); // 署名URLの無い写真は出さない
  assert.match(html, /HOTPEPPER Beauty/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.equal(renderToStaticMarkup(createElement(StoreAssetsSection, { assets: null })), "");
  assert.equal(renderToStaticMarkup(createElement(StoreAssetsSection, { assets: { ...assets, logoPath: null, logoUrl: null, photos: [], links: [] } })), "");
  assert.equal(renderToStaticMarkup(createElement(StoreAssetsSection, { assets: { ...assets, photos: [], links: [] } })), ""); // ロゴだけなら写真の欄は出さない
  assert.equal(hasAnyStoreAsset(null), false);
});
test("店舗詳細: assets を渡さなければ従来どおり（アカウント共通の画像・リンクは表示しない）", () => {
  const base = { store_name: "店", prefecture: "東京都", city: null, street_address: null, culture_description: null, employee_size_code: null, target_specialties: [], bio: null, hotpepper_url: null, culture: null } as never;
  const without = renderToStaticMarkup(createElement(StoreDetailView, { store: base, employeeSizeLabel: null, matchSection: null }));
  assert.doesNotMatch(without, /signed\.test/);
  const withAssets = renderToStaticMarkup(createElement(StoreDetailView, { store: base, employeeSizeLabel: null, matchSection: null, assets }));
  assert.match(withAssets, /signed\.test\/p1/);
});
test("ロゴ: 店名の左に小さく表示し、未登録なら何も出さずレイアウトが崩れない（写真の一覧とは別）", () => {
  const base = { store_name: "店", prefecture: "東京都", city: null, street_address: null, culture_description: null, employee_size_code: null, target_specialties: [], bio: null, hotpepper_url: null, culture: null } as never;
  const withLogo = renderToStaticMarkup(createElement(StoreDetailView, { store: base, employeeSizeLabel: null, matchSection: null, assets }));
  const logoIdx = withLogo.indexOf("signed.test/logo"), nameIdx = withLogo.indexOf(">店</h1>");
  assert.ok(logoIdx > 0 && nameIdx > logoIdx, "ロゴが店名より前（左）にある");
  assert.match(withLogo, /h-10 w-10[^"]*object-contain/); // 40px 角・引き伸ばさない
  const noLogo = renderToStaticMarkup(createElement(StoreDetailView, { store: base, employeeSizeLabel: null, matchSection: null, assets: { ...assets, logoPath: null, logoUrl: null } }));
  assert.doesNotMatch(noLogo, /ロゴ/);
  assert.match(noLogo, /<h1[^>]*>店<\/h1>/);
  assert.equal((noLogo.match(/<img/g) ?? []).length, 1); // 写真1枚のみ
});
test("写真の表示枠: スマホも広い画面も1枚ずつ横幅いっぱい・縦横比4:3で切り抜き", () => {
  assert.match(STORE_PHOTO_GRID_CLASS, /grid-cols-1/);
  assert.doesNotMatch(STORE_PHOTO_GRID_CLASS, /cols-[2-9]/); // 小さな並びにしない（広い画面でも1枚ずつ大きく）
  assert.match(STORE_PHOTO_FRAME_CLASS, /aspect-\[4\/3\]/);
  assert.match(STORE_PHOTO_FRAME_CLASS, /w-full/);
  assert.match(STORE_PHOTO_IMAGE_CLASS, /object-cover/);
  assert.equal(STORE_PHOTO_MAX, 8);
  const html = renderToStaticMarkup(createElement(StoreAssetsSection, { assets: { ...assets, photos: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, category: "photo" as const, storagePath: `${S}/photo/${i}.webp`, sortOrder: i, url: `https://signed.test/p${i}` })) } }));
  assert.equal((html.match(/aspect-\[4\/3\]/g) ?? []).length, 8);
  assert.equal((html.match(/object-cover/g) ?? []).length, 8);
});
test("parse: 写真は sort_order 順（カテゴリでは並べない）。旧DB（カテゴリごとの番号）でも落ちない／photo カテゴリを読める", () => {
  const r = parseStoreAssetsJson(json({ photos: [
    { id: "c", category: "photo", storage_path: `${S}/photo/c.webp`, sort_order: 2 },
    { id: "a", category: "atmosphere", storage_path: `${S}/atmosphere/a.webp`, sort_order: 1 },
    { id: "b", category: "interior", storage_path: `${S}/interior/b.webp`, sort_order: 0 },
  ] }), S)!;
  assert.deepEqual(r.photos.map((p) => p.id), ["b", "a", "c"]);
  const old = parseStoreAssetsJson(json({ photos: [
    { id: "a0", category: "atmosphere", storage_path: `${S}/atmosphere/a0.webp`, sort_order: 0 },
    { id: "i1", category: "interior", storage_path: `${S}/interior/i1.webp`, sort_order: 1 },
    { id: "i0", category: "interior", storage_path: `${S}/interior/i0.webp`, sort_order: 0 },
  ] }), S)!;
  assert.deepEqual(old.photos.map((p) => p.id), ["i0", "a0", "i1"]);
});

test("静的確認: 画面は店舗別の取得・保存だけを使い、アカウント共通の取得処理を直接呼ばない／保存は店舗IDを渡す", () => {
  const view = strip("components/store-assets/store-assets-section.tsx");
  assert.doesNotMatch(view, /salon_photos|salon_links|avatar_path|salon-photos/);
  const actions = strip("lib/store-assets/actions.ts") + strip("lib/store-assets/service.ts");
  assert.doesNotMatch(actions, /salon_photos|salon_links|"avatars"|"salon-photos"/);
  for (const fn of ["set_store_logo", "add_store_photo", "delete_store_photo", "add_store_link", "delete_store_link"]) assert.match(actions, new RegExp(fn));
  // 失敗時に渡された画像を無条件に削除する処理が残っていない（削除は service の安全確認を通す）
  assert.doesNotMatch(strip("lib/store-assets/actions.ts"), /removeObjects\(supabase|\.remove\(\[?storagePath/);
  const editor = strip("components/store-assets/store-assets-editor.tsx");
  assert.match(editor, /\$\{storeId\}\/\$\{STORE_PHOTO_FOLDER\}\//); // アップロード先は {storeId}/photo/…（分類なし）
  assert.match(editor, /cacheControl: STORE_ASSET_CACHE_CONTROL/);
  const page = strip("app/salon/stores/[storeId]/profile/page.tsx");
  assert.match(page, /canManageStoreHiringHint/);
  assert.match(page, /canManage \?/); // 閲覧のみにはフォームを出さない
  const stylist = strip("app/stylist/salons/[storeId]/page.tsx");
  assert.match(stylist, /loadStoreAssets\(supabase, store\.store_id, "stylist"\)/);
  const preview = strip("app/salon/stores/[storeId]/preview/page.tsx");
  assert.match(preview, /loadStoreAssets\(supabase, storeId, "staff"\)/);
});

// ---- 保存処理（service）: 画像を消してよい場合・消さない場合 ----
type Reply = { data?: unknown; error?: RpcError };
function fakeDeps(handlers: Record<string, (args: Record<string, unknown>, n: number) => Reply>, removeFails = false) {
  const calls: string[] = [];
  const removed: string[] = [];
  const counts: Record<string, number> = {};
  const deps: StoreAssetDeps = {
    rpc: async (fn, args) => {
      calls.push(fn);
      counts[fn] = (counts[fn] ?? 0) + 1;
      const r = handlers[fn]?.(args, counts[fn]) ?? { data: null, error: null };
      return { data: r.data ?? null, error: r.error ?? null };
    },
    removeObjects: async (paths) => { if (removeFails) return { error: { message: "x", code: "500" } }; removed.push(...paths); return { error: null }; },
    sign: async (path) => `https://signed.test/${path}`,
    log: () => {},
  };
  return { deps, calls, removed };
}
const NEW = `${S}/interior/new.webp`;
const assetsJson = (photos: { id: string; category: string; storage_path: string; sort_order: number }[] = [], logo: string | null = null) =>
  ({ store_id: S, logo_path: logo, photos, links: [] });
const REJECT: RpcError = { message: "store write permission required", code: "P0001" };
const NETWORK: RpcError = { message: "TypeError: fetch failed", code: "" };

test("写真追加: 保存後に通信が切れた（結果不明）ときは画像を消さない（保存済みの可能性がある）", async () => {
  const f = fakeDeps({ get_store_assets: () => ({ data: assetsJson() }), add_store_photo: () => ({ error: NETWORK }) });
  const r = await addStorePhoto(f.deps, S, NEW);
  assert.equal(r.success, false);
  assert.deepEqual(f.removed, []);
  assert.deepEqual(f.calls, ["get_store_assets", "add_store_photo"]); // 確認のための再取得もしない（結果不明は触らない）
});
test("写真追加: 保存後に通信が切れて再送したら、二重登録せず登録済みの写真を成功として返す（画像は消さない）", async () => {
  const f = fakeDeps({ get_store_assets: () => ({ data: assetsJson([{ id: "p9", category: "interior", storage_path: NEW, sort_order: 0 }]) }) });
  const r = await addStorePhoto(f.deps, S, NEW);
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.photo.id, "p9");
  assert.deepEqual(f.removed, []);
  assert.ok(!f.calls.includes("add_store_photo"));
});
test("写真追加: 重複送信で2回目がDB拒否（重複エラー）になっても、先に登録済みの画像は消さない", async () => {
  // 2回目の呼び出し時点で読み取り→空、追加→一意制約違反、再取得→登録済み（同時に1回目が成功した状況）
  let reads = 0;
  const f = fakeDeps({
    get_store_assets: () => ({ data: ++reads === 1 ? assetsJson() : assetsJson([{ id: "p1", category: "interior", storage_path: NEW, sort_order: 0 }]) }),
    add_store_photo: () => ({ error: { message: "duplicate key value violates unique constraint", code: "23505" } }),
  });
  const r = await addStorePhoto(f.deps, S, NEW);
  assert.equal(r.success, false);
  assert.deepEqual(f.removed, []);
});
test("写真追加: 最初に登録内容を取れなければ何も消さず、DBも呼ばない", async () => {
  const f = fakeDeps({ get_store_assets: () => ({ error: { message: "x", code: "" } }) });
  const r = await addStorePhoto(f.deps, S, NEW);
  assert.equal(r.success, false);
  assert.deepEqual(f.removed, []);
  assert.deepEqual(f.calls, ["get_store_assets"]);
});
test("写真追加: 他の用途（ロゴ・別の写真）で使用中のパスなら、登録も削除もしない", async () => {
  const f = fakeDeps({ get_store_assets: () => ({ data: assetsJson([], NEW) }) });
  const r = await addStorePhoto(f.deps, S, NEW);
  assert.equal(r.success, false);
  assert.deepEqual(f.removed, []);
  assert.ok(!f.calls.includes("add_store_photo"));
});
test("ロゴ設定: 重複送信（同じパスの再送）は成功し、登録済みの画像を消さない／差し替え時は古い画像だけ消す", async () => {
  const path = `${S}/logo/new.webp`;
  const dup = fakeDeps({ set_store_logo: () => ({ data: path }) }); // DB が返す「前のパス」が今回と同じ
  const r = await setStoreLogo(dup.deps, S, path);
  assert.equal(r.success, true);
  assert.deepEqual(dup.removed, []);
  const old = `${S}/logo/old.webp`;
  const rep = fakeDeps({ set_store_logo: () => ({ data: old }) });
  assert.equal((await setStoreLogo(rep.deps, S, path)).success, true);
  assert.deepEqual(rep.removed, [old]);
});
test("ロゴ設定: 保存は成功したがStorageの削除に失敗しても、保存成功として返す（新しい画像は残る）", async () => {
  const path = `${S}/logo/new.webp`;
  const f = fakeDeps({ set_store_logo: () => ({ data: `${S}/logo/old.webp` }) }, true);
  const r = await setStoreLogo(f.deps, S, path);
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.logoPath, path);
});
test("写真削除: DBが拒否したらStorageは触らない／成功したときだけDBが返したパスを消す", async () => {
  const a = fakeDeps({ delete_store_photo: () => ({ error: REJECT }) });
  assert.equal((await deleteStorePhoto(a.deps, "p1")).success, false);
  assert.deepEqual(a.removed, []);
  const b = fakeDeps({ delete_store_photo: () => ({ data: NEW }) });
  assert.equal((await deleteStorePhoto(b.deps, "p1")).success, true);
  assert.deepEqual(b.removed, [NEW]);
});

// ---- 同時操作で使用中の画像を消さない: 失敗・上限・結果不明では、どんな順序でも削除しない ----
test("写真追加: DB拒否（確定）でも、通信失敗（結果不明）でも、アップロード済みの画像は削除しない", async () => {
  for (const error of [REJECT, NETWORK, { message: "x" }]) {
    const f = fakeDeps({ get_store_assets: () => ({ data: assetsJson() }), add_store_photo: () => ({ error }) });
    assert.equal((await addStorePhoto(f.deps, S, NEW)).success, false);
    assert.deepEqual(f.removed, []);
  }
});
test("写真追加: 上限（8枚）を超える場合も画像は削除しない（登録の確認と削除の間に別の保存が入っても消えない）", async () => {
  const ph = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, category: i < 3 ? "interior" : "photo", storage_path: `${S}/${i < 3 ? "interior" : "photo"}/${i}.webp`, sort_order: i }));
  const f = fakeDeps({ get_store_assets: () => ({ data: assetsJson(ph) }) });
  const r = await addStorePhoto(f.deps, S, NEW);
  assert.equal(r.success, false);
  if (!r.success) assert.match(r.error, /最大8枚/);
  assert.deepEqual(f.removed, []);
  assert.ok(!f.calls.includes("add_store_photo")); // 事前確認で止める（DB の上限が最終判定）
});
test("写真追加: 7枚なら追加できる（分類なし photo で DB を呼ぶ・番号は DB が決める）／DB が9枚目を拒否しても画像は消さない", async () => {
  const ph = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, category: "photo", storage_path: `${S}/photo/${i}.webp`, sort_order: i }));
  let sent: Record<string, unknown> = {};
  const ok = fakeDeps({ get_store_assets: () => ({ data: assetsJson(ph) }), add_store_photo: (a) => { sent = a; return { data: { id: "pn", sort_order: 7 } }; } });
  const r = await addStorePhoto(ok.deps, S, `${S}/photo/new.webp`);
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.photo.sortOrder, 7);
  assert.equal(sent.p_category, "photo");
  // 事前確認の後に別の端末が8枚目を入れた（DB が拒否）: 画像は消さない
  const race = fakeDeps({ get_store_assets: () => ({ data: assetsJson(ph) }), add_store_photo: () => ({ error: { message: "store already has the maximum of 8 photos", code: "P0001" } }) });
  const rr = await addStorePhoto(race.deps, S, `${S}/photo/new.webp`);
  assert.equal(rr.success, false);
  if (!rr.success) assert.match(rr.error, /最大8枚/);
  assert.deepEqual(race.removed, []);
});
test("写真差し替え: 成功しても旧画像は削除しない（残す）／拒否・通信失敗でも何も消さない", async () => {
  const old = `${S}/interior/old.webp`;
  const ok = fakeDeps({ replace_store_photo: () => ({ data: old }) });
  const r = await replaceStorePhoto(ok.deps, "p1", `${S}/photo/new.webp`);
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.storagePath, `${S}/photo/new.webp`);
  assert.deepEqual(ok.removed, []);
  for (const error of [REJECT, NETWORK]) {
    const f = fakeDeps({ replace_store_photo: () => ({ error }) });
    assert.equal((await replaceStorePhoto(f.deps, "p1", `${S}/photo/new.webp`)).success, false);
    assert.deepEqual(f.removed, []);
  }
  const same = fakeDeps({ replace_store_photo: () => ({ data: `${S}/photo/new.webp` }) });
  assert.equal((await replaceStorePhoto(same.deps, "p1", `${S}/photo/new.webp`)).success, true);
  assert.deepEqual(same.removed, []);
});
test("写真差し替え: 差し替え後に別リクエストが旧パスを再登録しても、使用中の画像は削除されない", async () => {
  const old = `${S}/interior/old.webp`;
  // 差し替えの応答（旧パス）→その直後に別リクエストが同じ旧パスを別の写真として登録、という順序を模擬
  const calls: string[] = [];
  const f = fakeDeps({
    replace_store_photo: () => { calls.push("replace"); return { data: old }; },
    get_store_assets: () => ({ data: assetsJson([]) }), // 差し替えで外れたので、旧パスは未登録に見える
    add_store_photo: () => { calls.push("re-register"); return { data: { id: "p2", sort_order: 3 } }; },
  });
  assert.equal((await replaceStorePhoto(f.deps, "p1", `${S}/photo/new.webp`)).success, true);
  const reg = await addStorePhoto(f.deps, S, old);
  assert.equal(reg.success, true);
  assert.deepEqual(f.removed, []); // どちらの操作でも Storage の削除は一度も呼ばれない（旧画像は残り、再登録された写真は表示できる）
  assert.deepEqual(calls, ["replace", "re-register"]);
});
test("静的確認: 編集画面に分類名・タブ・分類の操作が無く、枚数表示「現在 n／8枚」・差し替え・削除がある", () => {
  const editor = strip("components/store-assets/store-assets-editor.tsx");
  assert.doesNotMatch(editor, /内装写真|スタッフ・サロンの雰囲気|店内の様子|role="tab"|interior|atmosphere/);
  assert.match(editor, /現在 \{photos\.length\}／\{STORE_PHOTO_MAX\}枚/);
  assert.match(editor, /replaceStorePhotoAction/);
  assert.match(editor, /deleteStorePhotoAction/);
  assert.match(editor, /店舗の写真/);
  assert.match(editor, /STORE_PHOTO_GRID_CLASS/); // 表示側と同じ枠
  const view = strip("components/store-assets/store-assets-section.tsx");
  assert.match(view, /STORE_PHOTO_GRID_CLASS/);
  assert.doesNotMatch(view, /interior|atmosphere/);
  const actions = strip("lib/store-assets/actions.ts");
  assert.match(actions, /replace_store_photo|replaceStorePhoto/);
});
test("写真追加: 確認後に別のリクエストが同じ画像を登録する順序を模擬しても、削除は一切呼ばれない", async () => {
  // 1回目の取得は空、追加は拒否、その間に別リクエストが同じパスを登録済みにした状況
  let reads = 0;
  const f = fakeDeps({
    get_store_assets: () => ({ data: ++reads === 1 ? assetsJson() : assetsJson([{ id: "px", category: "interior", storage_path: NEW, sort_order: 0 }]) }),
    add_store_photo: () => ({ error: { message: "duplicate key", code: "23505" } }),
  });
  await addStorePhoto(f.deps, S, NEW);
  assert.deepEqual(f.removed, []);
  assert.equal(f.calls.filter((c) => c === "get_store_assets").length, 1); // 再確認のための取得もしない
});
test("ロゴ設定: DB拒否・通信失敗・使用中のどれでも、渡された画像は削除しない", async () => {
  const path = `${S}/logo/new.webp`;
  for (const error of [REJECT, NETWORK]) {
    const f = fakeDeps({ set_store_logo: () => ({ error }) });
    assert.equal((await setStoreLogo(f.deps, S, path)).success, false);
    assert.deepEqual(f.removed, []);
  }
});
test("静的確認: 保存処理に「確認してから削除」の経路（未登録確認・条件付き削除）が残っていない", () => {
  const svc = strip("lib/store-assets/service.ts");
  assert.doesNotMatch(svc, /removeUploadedIfSafe|isDefiniteRejection/);
  const replaceFn = svc.slice(svc.indexOf("export async function replaceStorePhoto"), svc.indexOf("export async function deleteStorePhoto"));
  assert.doesNotMatch(replaceFn, /removeObjects/); // 写真の差し替えは旧画像を削除しない
  // Storage の削除は、DB が返した前のパス／削除した写真のパスにだけ使う（storagePath を直接渡す削除が無い）
  assert.doesNotMatch(svc, /removeObjects\(\[storagePath\]\)/);
});
