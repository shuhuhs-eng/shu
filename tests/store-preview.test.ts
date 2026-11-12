import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StoreDetailView } from "../components/stylist-salons/store-detail-view";
import { loadStorePreview } from "../lib/store-preview/load";

const strip = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");

const K = ["education_support","challenge_openness","personal_brand_support","team_collaboration","individual_autonomy","work_flexibility","technical_specialization","premium_value","trend_orientation","creative_output","relationship_distance","hierarchy_flatness"];
const axes = Object.fromEntries(K.map((k, i) => [k, [3,4,2,3,3,3,3,3,5,5,3,3][i] * 25 - 25]));

// 簡易のSupabaseモック: テーブル名→行（RLSで見える行だけを入れる）。呼ばれた select の列も記録する。
type Row = Record<string, unknown>;
function mockClient(tables: Record<string, Row[]>, errors: Record<string, { code?: string; message: string }> = {}) {
  const calls: Array<{ table: string; cols: string; filters: Array<[string, unknown]> }> = [];
  const client = {
    from(table: string) {
      const rec = { table, cols: "", filters: [] as Array<[string, unknown]> };
      calls.push(rec);
      type Q = {
        select(cols: string): Q;
        eq(col: string, v: unknown): Q;
        order(): Q;
        maybeSingle(): Promise<{ data: Row | null; error: { code?: string; message: string } | null }>;
      };
      const q: Q = {
        select(cols: string) { rec.cols = cols; return q; },
        eq(col: string, v: unknown) { rec.filters.push([col, v]); return q; },
        order() { return q; },
        maybeSingle() {
          if (errors[table]) return Promise.resolve({ data: null, error: errors[table] });
          const rows = (tables[table] ?? []).filter((r) => rec.filters.every(([c, v]) => r[c] === v));
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
      };
      return q;
    },
  };
  return { client: client as never, calls };
}

const S1 = "11111111-1111-1111-1111-111111111111";
const S2 = "22222222-2222-2222-2222-222222222222";
const tablesBase = {
  salon_stores: [{ id: S1, store_name: "渋谷店", organization_id: "org-secret" }, { id: S2, store_name: "新宿店", organization_id: "org-secret" }],
  salon_store_profiles: [
    { store_id: S1, visibility: "PUBLIC", prefecture: "東京都", city: "渋谷区", street_address: "1-1", culture_description: "渋谷の紹介文", employee_size_code: "s5", target_specialties: ["カラー"], bio: "渋谷の自己紹介", hotpepper_url: null },
    { store_id: S2, visibility: "PRIVATE", prefecture: "東京都", city: "新宿区", street_address: "2-2", culture_description: "新宿の紹介文", employee_size_code: null, target_specialties: [], bio: "新宿の自己紹介", hotpepper_url: "https://example.com/s2" },
  ],
  salon_store_culture_profiles: [
    { store_id: S1, id: "c1", status: "completed", culture_axes: axes, value_priorities: ["a"], comment: "渋谷の一言", ai_summary: "渋谷のAI紹介" },
    { store_id: S2, id: "c2", status: "draft", culture_axes: null, value_priorities: null, comment: "新宿の下書き", ai_summary: "新宿の下書きAI" },
  ],
  employee_size_master: [{ code: "s5", label: "1〜5名" }],
};

test("プレビューの取得: 対象店舗の公開項目だけを組み立て、別店舗・内部情報を混ぜない", async () => {
  const { client, calls } = mockClient(tablesBase);
  const r = await loadStorePreview(client, S1);
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  assert.equal(r.store.store_name, "渋谷店");
  assert.equal(r.store.bio, "渋谷の自己紹介");
  assert.equal(r.visibility, "PUBLIC");
  assert.equal(r.employeeSizeLabel, "1〜5名");
  assert.equal(r.store.culture?.comment, "渋谷の一言");
  const json = JSON.stringify(r);
  for (const leak of ["新宿", "org-secret", "organization_id", "store_members", "billing"]) assert.ok(!json.includes(leak), leak);
  // 美容師向けRPCが返す項目と同じ列だけを選ぶ（organization_id等は選ばない）
  const cols = calls.map((c) => c.cols).join(",");
  assert.ok(!/organization_id|\*/.test(cols));
  // どの問い合わせも対象の店舗IDで絞っている
  for (const c of calls.filter((x) => x.table !== "employee_size_master")) {
    assert.ok(c.filters.some(([col, v]) => (col === "id" || col === "store_id") && v === S1), c.table);
  }
});

test("プレビューの取得: 店舗カルチャーは completed のときだけ。下書きは出さない（美容師向けRPCと同じ）", async () => {
  const { client } = mockClient(tablesBase);
  const r = await loadStorePreview(client, S2);
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  assert.equal(r.store.culture, null);
  assert.equal(r.visibility, "PRIVATE");
  assert.ok(!JSON.stringify(r).includes("新宿の下書き"));
});

test("プレビューの取得: 権限のない店舗・存在しない店舗は区別せず not_found（RLSで行が返らない場合）", async () => {
  const none = mockClient({ ...tablesBase, salon_stores: [] });
  assert.deepEqual(await loadStorePreview(none.client, S1), { status: "not_found" });
  const bad = mockClient(tablesBase, { salon_stores: { code: "22P02", message: "invalid input syntax for type uuid" } });
  assert.deepEqual(await loadStorePreview(bad.client, "not-a-uuid"), { status: "not_found" });
});

test("プレビューの取得: 取得失敗は『未登録』ではなく error。プロフィール未保存は no_profile", async () => {
  for (const table of ["salon_stores", "salon_store_profiles", "salon_store_culture_profiles", "employee_size_master"]) {
    const { client } = mockClient(tablesBase, { [table]: { code: "XX000", message: "boom" } });
    assert.deepEqual(await loadStorePreview(client, S1), { status: "error" }, table);
  }
  const np = mockClient({ ...tablesBase, salon_store_profiles: [] });
  assert.deepEqual(await loadStorePreview(np.client, S1), { status: "no_profile", storeName: "渋谷店" });
});

test("共用表示部品: 美容師向けと同じ構成（店舗情報→店舗の一言→相性→タイプ→価値観→AI紹介）。相性は渡された内容を表示", () => {
  const html = renderToStaticMarkup(
    createElement(StoreDetailView, {
      store: {
        store_name: "渋谷店", prefecture: "東京都", city: "渋谷区", street_address: "1-1", culture_description: "紹介文", employee_size_code: "s5",
        target_specialties: ["カラー"], bio: "自己紹介", hotpepper_url: "https://example.com/hp",
        culture: { culture_profile_id: "c1", culture_axes: axes as never, value_priorities: ["a"], comment: "一言", ai_summary: "AI紹介" },
      },
      employeeSizeLabel: "1〜5名",
      matchSection: createElement("section", null, "相性は美容師の回答によって変わります。"),
    }),
  );
  const order = ["渋谷店", "店舗からの一言", "相性は美容師の回答によって変わります", "この店舗のタイプ", "今、大切にしている価値観", "AIによる店舗紹介", "ホットペッパービューティーを見る"].map((t) => html.indexOf(t));
  assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(html, /トレンド・発信型/);
  assert.match(html, /従業員数: 1〜5名/);
});

test("美容師向け店舗詳細は共用部品を使い、相性計算・話を聞いてみたいは従来どおり残る", () => {
  const c = strip("app/stylist/salons/[storeId]/page.tsx");
  assert.match(c, /StoreDetailView/);
  assert.match(c, /calculateStylistStoreMatch/);
  assert.match(c, /StoreInterestButton/);
  assert.match(c, /getPublicSalonStoreDetail/);
  assert.match(c, /総合マッチ度/);
});

test("プレビュー画面: 閲覧専用。操作・相性計算・通知・記録・書き込みを一切呼ばない", () => {
  for (const f of ["app/salon/stores/[storeId]/preview/page.tsx", "components/store-preview/preview-body.tsx", "lib/store-preview/load.ts"]) {
    const c = strip(f);
    assert.ok(!/StoreInterestButton|FavoriteSalonButton|setStoreInterestAction|calculateStylistStoreMatch|calculate_stylist_store_match/.test(c), f);
    assert.ok(!/\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|fetch\(/.test(c), f);
    assert.ok(!/notification|scout|offer|apply|application/i.test(c.replace(/scouts?/g, "")), f);
  }
});

test("プレビュー画面の表示: 見出し・店舗名・導線・未保存の注意・相性の案内。架空の相性数値を出さない", () => {
  const c = readFileSync("app/salon/stores/[storeId]/preview/page.tsx", "utf8") + readFileSync("components/store-preview/preview-body.tsx", "utf8");
  assert.match(c, /美容師からの見え方（プレビュー）/);
  assert.match(c, /プロフィールを編集する/);
  assert.match(c, /マイページへ戻る/);
  assert.match(c, /未保存の内容は反映されません/);
  assert.match(c, /相性は美容師の回答によって変わります/);
  assert.ok(!/総合マッチ度|overall_score|axis_scores/.test(c));
  assert.match(c, /\/salon\/stores\/\$\{storeId\}\/profile/);
  // 認証・ロール・RLS前提のアクセス判定、取得失敗はエラー表示（未登録扱いにしない）
  assert.match(c, /redirect\(`\/login\?next=/);
  assert.match(c, /hasCompletedRole\(supabase, user\.id, "salon"\)/);
  assert.match(c, /CultureResultLoadError/);
});

test("RLS・公開範囲は変更していない: 新しいmigrationを追加していない", () => {
  const files = readdirSync("supabase/migrations").filter((f: string) => f.endsWith(".sql")).sort();
  assert.equal(files[files.length - 1].slice(0, 4), "0056");
});

test("サロンマイページ: プロフィール概要に入口を置き、店舗ごとの別URLへ（取得失敗は別表示）", () => {
  const c = strip("app/salon/mypage/page.tsx");
  assert.match(c, /美容師からの見え方を確認/);
  assert.match(c, /\/salon\/stores\/\$\{st\.id\}\/preview/);
  assert.match(c, /previewStoresError/);
  const raw = readFileSync("app/salon/mypage/page.tsx", "utf8");
  const edit = raw.indexOf("サロンプロフィールを編集");
  const preview = raw.indexOf("美容師からの見え方を確認", edit);
  assert.ok(edit > 0 && preview > edit && preview < raw.indexOf('id="interests"'));
});
