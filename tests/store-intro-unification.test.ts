import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { salonStoreProfileFormSchema, STORE_INTRO_MAX } from "../lib/validation/salon-store-profile";
import { saveStoreProfile, STORE_PROFILE_TEXT_STALE, STORE_PROFILE_DISPLAY_STALE, STORE_PROFILE_SAVE_FAILED } from "../lib/salon/store-profile-save";

const S = "00000000-0000-0000-0000-0000000000b0";
const base = { salonName: "S", prefecture: "東京都", city: "", streetAddress: "", employeeSizeCode: "", targetSpecialties: ["カット"], bio: "", hotpepperUrl: "", visibility: "PUBLIC" } as const;
function fake(res: { data?: unknown; error?: { message: string } | null }) {
  const calls: Record<string, unknown>[] = [];
  return { calls, deps: { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, ...args }); return { data: res.data ?? { store_id: S, visibility: "PUBLIC" }, error: res.error ?? null }; }, log: () => {} } };
}

test("店舗紹介の上限は3,000字: ちょうどは通り、3,001字は通らない（自動で切り詰めない）", () => {
  assert.equal(STORE_INTRO_MAX, 3000);
  assert.equal(salonStoreProfileFormSchema.safeParse({ ...base, bio: "あ".repeat(3000) }).success, true);
  const r = salonStoreProfileFormSchema.safeParse({ ...base, bio: "あ".repeat(3001) });
  assert.equal(r.success, false);
});
test("保存は新RPC(v2)で、文化欄(culture)を一切送らない。期待リビジョンと表示指定を渡す", async () => {
  const parsed = salonStoreProfileFormSchema.parse({ ...base, bio: "紹介", expectedRevision: "5", introDisplay: "unified" });
  const f = fake({});
  const r = await saveStoreProfile(f.deps, S, parsed);
  assert.equal(r.success, true);
  assert.equal(f.calls[0].fn, "save_salon_store_profile_v2");
  assert.ok(!("p_culture_description" in f.calls[0]));
  assert.equal(f.calls[0].p_expected_revision, 5);
  assert.equal(f.calls[0].p_intro_display, "unified");
});
test("表示指定が無ければ keep（文化欄の表示を変えない）。不正な値は検証で弾く", async () => {
  const f = fake({});
  await saveStoreProfile(f.deps, S, salonStoreProfileFormSchema.parse({ ...base }));
  assert.equal(f.calls[0].p_intro_display, "keep");
  assert.equal(f.calls[0].p_expected_revision, null);
  assert.equal(salonStoreProfileFormSchema.safeParse({ ...base, introDisplay: "delete" }).success, false);
});
test("競合・保護は専用の文言（入力は画面に残る）。その他のDBエラーの内容は画面に出さない", async () => {
  const v = salonStoreProfileFormSchema.parse({ ...base });
  assert.deepEqual(await saveStoreProfile(fake({ error: { message: "profile_text_stale" } }).deps, S, v), { success: false, error: STORE_PROFILE_TEXT_STALE });
  assert.deepEqual(await saveStoreProfile(fake({ error: { message: "profile_display_stale" } }).deps, S, v), { success: false, error: STORE_PROFILE_DISPLAY_STALE });
  assert.deepEqual(await saveStoreProfile(fake({ error: { message: "salon_store_profiles_bio_check violated" } }).deps, S, v), { success: false, error: STORE_PROFILE_SAVE_FAILED });
  assert.match(STORE_PROFILE_TEXT_STALE, /入力内容は画面に残っています/);
});
test("フォームには文化欄の入力欄がなく、旧文化欄は読み取り表示・取り込み支援・表示の切り替えだけ（削除操作なし）", () => {
  const form = readFileSync("components/salon-profile/salon-store-profile-form.tsx", "utf8");
  const field = readFileSync("components/salon-profile/store-intro-field.tsx", "utf8");
  assert.doesNotMatch(form, /name="cultureDescription"/);
  assert.match(form, /expectedRevision/);
  assert.match(field, /name="introDisplay"/);
  assert.match(field, /削除されません/);
  assert.doesNotMatch(field, /name="cultureDescription"/);
  const action = readFileSync("lib/salon/store-actions.ts", "utf8");
  assert.doesNotMatch(action, /cultureDescription/);
});
test("プレビューは統合済みなら公開側と同じく旧文化欄を出さない。旧カードは紹介(bio)を優先する", () => {
  const load = readFileSync("lib/store-preview/load.ts", "utf8");
  assert.match(load, /intro_unified_at \? null : profile\.culture_description/);
  const card = readFileSync("components/stylist-salons/salon-card.tsx", "utf8");
  assert.match(card, /salon\.bio \|\| salon\.culture_description/);
});

test("文字数は画面・サーバー・DBで同じ数え方: 絵文字は1文字、改行(CRLF送信)は1文字、前後の空白は除く", async () => {
  const { countIntroChars } = await import("../lib/validation/salon-store-profile");
  assert.equal(countIntroChars("😀".repeat(3000)), 3000);
  assert.equal(salonStoreProfileFormSchema.safeParse({ ...base, bio: "😀".repeat(3000) }).success, true);
  assert.equal(salonStoreProfileFormSchema.safeParse({ ...base, bio: "😀".repeat(3001) }).success, false);
  // ZWJ 絵文字は複数のコードポイント（DB の char_length と同じ数え方）
  assert.equal(countIntroChars("👨‍👩‍👧"), 5);
  // ブラウザのフォーム送信は改行を CRLF にする。画面（LF）と同じ 1 文字として数える
  const crlf = "あ\r\n".repeat(1500);
  assert.equal(countIntroChars(crlf), 2999);
  const r = salonStoreProfileFormSchema.safeParse({ ...base, bio: "あ\r\n".repeat(1499) + "いう" });
  assert.equal(r.success, true);
  if (r.success) assert.ok(!r.data.bio!.includes("\r"), "保存する値は LF に揃える");
  assert.equal(salonStoreProfileFormSchema.safeParse({ ...base, bio: "あ\r\n".repeat(1499) + "いうえ" }).success, false);
  assert.equal(countIntroChars("  あ  "), 1);
});
