import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SALON_VISIBILITY_NEW_DEFAULT, SALON_VISIBILITY_OPTIONS, toSalonVisibilityChoice } from "../lib/salon/store-visibility";
import { saveStoreProfile, STORE_PROFILE_SAVE_FAILED, STORE_PROFILE_SAVE_UNCONFIRMED, type StoreProfileSaveDeps } from "../lib/salon/store-profile-save";
import { salonStoreProfileFormSchema } from "../lib/validation/salon-store-profile";
import { getSalonStoreProfileFormInitialValues } from "../lib/salon/store-get-initial-values";
import { SalonVisibilityField } from "../components/salon-profile/salon-visibility-field";

const S = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const strip = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");

const values = (visibility: "PUBLIC" | "PRIVATE") => ({
  salonName: "テスト店", prefecture: "神奈川県", city: "横浜市", streetAddress: "", cultureDescription: "", employeeSizeCode: "",
  targetSpecialties: ["カット"] as never, bio: "", hotpepperUrl: "", visibility,
});
function fakeRpc(reply: (args: Record<string, unknown>) => { data?: unknown; error?: { message: string; code?: string } | null }) {
  const calls: Record<string, unknown>[] = [];
  const deps: StoreProfileSaveDeps = {
    rpc: async (fn, args) => { assert.equal(fn, "save_salon_store_profile"); calls.push(args); const r = reply(args); return { data: r.data ?? null, error: r.error ?? null }; },
    log: () => {},
  };
  return { deps, calls };
}
const echo = (args: Record<string, unknown>) => ({ data: { store_id: args.p_store_id, visibility: args.p_visibility } });

test("公開範囲の選択肢は「公開」「非公開（現在募集はしていません）」の2択だけ", () => {
  assert.deepEqual(SALON_VISIBILITY_OPTIONS.map((o) => [o.value, o.label]), [["PUBLIC", "公開"], ["PRIVATE", "非公開（現在募集はしていません）"]]);
  assert.equal(SALON_VISIBILITY_NEW_DEFAULT, "PUBLIC");
});
test("既存値の写し方: PUBLIC だけが公開。PRIVATE・一部公開(LIMITED)・不明は非公開として表示（自動で公開にしない）", () => {
  assert.equal(toSalonVisibilityChoice("PUBLIC"), "PUBLIC");
  for (const v of ["PRIVATE", "LIMITED", "", null, undefined, "x"]) assert.equal(toSalonVisibilityChoice(v as never), "PRIVATE");
});
test("公開で保存: 選んだ値がそのまま RPC の p_visibility に渡り、対象店舗の p_store_id だけが使われ、成功になる", async () => {
  const f = fakeRpc(echo);
  const r = await saveStoreProfile(f.deps, S, values("PUBLIC"));
  assert.equal(r.success, true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].p_visibility, "PUBLIC");
  assert.equal(f.calls[0].p_store_id, S);
  assert.notEqual(f.calls[0].p_store_id, OTHER);
});
test("非公開で保存: PRIVATE がそのまま渡り、成功になる", async () => {
  const f = fakeRpc(echo);
  assert.equal((await saveStoreProfile(f.deps, S, values("PRIVATE"))).success, true);
  assert.equal(f.calls[0].p_visibility, "PRIVATE");
});
test("保存失敗を成功として表示しない: RPC のエラー／保存された行が無い／公開範囲や店舗が送った値と違う、はすべて失敗", async () => {
  const e = await saveStoreProfile(fakeRpc(() => ({ error: { message: "x", code: "42501" } })).deps, S, values("PUBLIC"));
  assert.deepEqual(e, { success: false, error: STORE_PROFILE_SAVE_FAILED });
  const none = await saveStoreProfile(fakeRpc(() => ({ data: null })).deps, S, values("PUBLIC"));
  assert.deepEqual(none, { success: false, error: STORE_PROFILE_SAVE_UNCONFIRMED });
  const wrongVis = await saveStoreProfile(fakeRpc((a) => ({ data: { store_id: a.p_store_id, visibility: "PRIVATE" } })).deps, S, values("PUBLIC"));
  assert.deepEqual(wrongVis, { success: false, error: STORE_PROFILE_SAVE_UNCONFIRMED });
  const wrongStore = await saveStoreProfile(fakeRpc((a) => ({ data: { store_id: OTHER, visibility: a.p_visibility } })).deps, S, values("PUBLIC"));
  assert.equal(wrongStore.success, false);
});
test("保存された行が配列で返っても（1件）正しく判定する", async () => {
  const f = fakeRpc((a) => ({ data: [{ store_id: a.p_store_id, visibility: a.p_visibility }] }));
  assert.equal((await saveStoreProfile(f.deps, S, values("PUBLIC"))).success, true);
});
test("入力検証: 公開・非公開は通り、一部公開(LIMITED)・不正値は通らない", () => {
  for (const v of ["PUBLIC", "PRIVATE"]) assert.equal(salonStoreProfileFormSchema.safeParse({ ...values("PUBLIC"), visibility: v }).success, true);
  for (const v of ["LIMITED", "", "public", undefined]) assert.equal(salonStoreProfileFormSchema.safeParse({ ...values("PUBLIC"), visibility: v }).success, false);
});

// ---- 初期値の取得（保存後の再取得・読み込み失敗の扱い）----
function fakeClient(profile: Record<string, unknown> | null, profileError: unknown = null) {
  return {
    from: (table: string) => ({
      select: () => table === "salon_store_profiles"
        ? { eq: () => ({ maybeSingle: async () => ({ data: profile, error: profileError }) }) }
        : { order: async () => ({ data: [], error: null }) },
    }),
  } as never;
}
const row = (visibility: string) => ({ store_id: S, salon_name: "店", visibility, prefecture: "神奈川県", city: null, street_address: null, culture_description: null, employee_size_code: null, target_specialties: ["カット"], bio: null, hotpepper_url: null });
test("再取得: 保存済みの公開は公開、非公開は非公開、一部公開は非公開として表示（公開へは変換しない）", async () => {
  assert.equal((await getSalonStoreProfileFormInitialValues(fakeClient(row("PUBLIC")), S)).initialValues.visibility, "PUBLIC");
  assert.equal((await getSalonStoreProfileFormInitialValues(fakeClient(row("PRIVATE")), S)).initialValues.visibility, "PRIVATE");
  assert.equal((await getSalonStoreProfileFormInitialValues(fakeClient(row("LIMITED")), S)).initialValues.visibility, "PRIVATE");
});
test("再取得: 店舗プロフィールがまだ無い（新規入力）ときだけ「公開」から始まる", async () => {
  const r = await getSalonStoreProfileFormInitialValues(fakeClient(null), S, "新店");
  assert.equal(r.initialValues.visibility, "PUBLIC");
  assert.equal(r.exists, false);
  assert.equal(r.loadError, false);
});
test("取得に失敗したときは loadError（フォームを出さない）。既定値の「公開」を保存させない", async () => {
  const r = await getSalonStoreProfileFormInitialValues(fakeClient(null, { message: "boom" }), S);
  assert.equal(r.loadError, true);
  const page = strip("app/salon/stores/[storeId]/profile/page.tsx");
  assert.match(page, /blocked\s*=\s*loadError\s*\|\|\s*storeError/);
  assert.match(page, /blocked\s*\?/); // blocked のときは編集画面を出さない
});

// ---- 画面 ----
test("公開範囲の部品: 2択だけ・補足文言なし・既存の一部公開は非公開が選ばれる・送信値は hidden に入る", () => {
  const html = renderToStaticMarkup(createElement(SalonVisibilityField, { defaultValue: "LIMITED" }));
  assert.equal((html.match(/role="radio"/g) ?? []).length, 2);
  assert.match(html, /公開/);
  assert.match(html, /非公開（現在募集はしていません）/);
  assert.doesNotMatch(html, /一部公開|自分のみ|閲覧/);
  assert.match(html, /<input type="hidden" name="visibility" value="PRIVATE"\/>/);
  assert.match(html, /data-value="PRIVATE"[^>]*>|aria-checked="true"[^>]*data-value="PRIVATE"/);
  const pub = renderToStaticMarkup(createElement(SalonVisibilityField, { defaultValue: "PUBLIC" }));
  assert.match(pub, /<input type="hidden" name="visibility" value="PUBLIC"\/>/);
});
test("フォーム: 一部公開・自分のみ閲覧の文言を使わず、手動送信（onSubmit）で、保存中は成功・失敗を出さない", () => {
  for (const f of ["components/salon-profile/salon-store-profile-form.tsx", "components/salon-profile/salon-profile-form.tsx"]) {
    const src = strip(f);
    assert.doesNotMatch(src, /VISIBILITY_LABELS|一部公開|自分のみ/);
    assert.match(src, /SalonVisibilityField/);
  }
  const form = strip("components/salon-profile/salon-store-profile-form.tsx");
  assert.match(form, /onSubmit=\{handleSubmit\}/);
  assert.doesNotMatch(form, /<form action=/);
  assert.match(form, /!isPending && state\.success/);
  assert.match(form, /isPending \? undefined : state\.error/);
  const labels = readFileSync("lib/validation/profile-options.ts", "utf8");
  assert.match(labels, /VISIBILITY_LABELS/); // 美容師側・既存の他の用途は変更していない
});
test("店舗プロフィールの保存処理: 公開範囲を書き換える処理（?? 'PRIVATE' など）が保存の経路に無い", () => {
  const act = strip("lib/salon/store-actions.ts") + strip("lib/salon/store-profile-save.ts");
  assert.doesNotMatch(act, /\?\?\s*"PRIVATE"|visibility\s*[:=]\s*"PRIVATE"/);
  assert.match(act, /p_visibility:\s*v\.visibility/);
});
test("ホーム: サロンでログイン中は「30問」の診断カード・CTA・説明を出さない（美容師・未ログインは従来どおり）", () => {
  const src = readFileSync("app/page.tsx", "utf8");
  assert.match(src, /view !== "stylist" && view !== "salon" && \(/); // 30問CTA
  assert.equal((src.match(/view !== "salon" && \(/g) ?? []).length >= 3, true); // 説明文・3アイコン列・CTA
  assert.match(src, /30問であなたのタイプを診断する/); // 診断機能そのもの・美容師側の表示は残る
  assert.match(src, /showStylistCard = view === "guest" \|\| view === "stylist"/);
});
