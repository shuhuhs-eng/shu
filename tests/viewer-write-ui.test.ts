import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StoreStylistCard } from "../components/scouts/store-stylist-card";
import { AgeRequestControl } from "../components/age-disclosure/age-request-control";

const strip = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");
const S = "11111111-1111-4111-8111-111111111111";
const stylist = { stylist_user_id: "u1", public_name: "公開A", prefecture: "東京都", current_position: "スタイリスト", experience_years: 5, desired_work_location: null, job_change_intent: "active", specialties: [], bio: null, age_request_status: "none" } as never;

test("閲覧のみ: スカウト送信フォームを出さず、理由を表示する／書き込み権限者には従来どおり出す", () => {
  const viewer = renderToStaticMarkup(createElement(StoreStylistCard, { storeId: S, stylist, match: null, latestScout: null, canManage: false }));
  assert.doesNotMatch(viewer, /スカウトを送る/);
  assert.match(viewer, /閲覧のみの権限のため、スカウトは送れません/);
  const writer = renderToStaticMarkup(createElement(StoreStylistCard, { storeId: S, stylist, match: null, latestScout: null }));
  assert.match(writer, /スカウトを送る/);
  assert.doesNotMatch(writer, /閲覧のみの権限/);
});
test("閲覧のみ: 実年齢の開示依頼ボタンは押せない", () => {
  const viewer = renderToStaticMarkup(createElement(AgeRequestControl, { storeId: S, stylistUserId: "u1", status: "none" as never, canManage: false }));
  assert.match(viewer, /disabled/);
  assert.match(viewer, /閲覧のみの権限のため、依頼はできません/);
  const writer = renderToStaticMarkup(createElement(AgeRequestControl, { storeId: S, stylistUserId: "u1", status: "none" as never }));
  assert.doesNotMatch(writer, /閲覧のみの権限/);
});
test("静的確認: 条件提示フォーム・店舗プロフィール・ロゴ/写真/リンクの編集は、閲覧のみに出さない", () => {
  const card = strip("components/store-activity/store-interest-card.tsx");
  assert.match(card, /canOffer && !canManage \?/);
  const profile = strip("app/salon/stores/[storeId]/profile/page.tsx");
  assert.match(profile, /canManageStoreHiringHint\(supabase, user\.id, storeId, store\.organization_id\)/);
  assert.match(profile, /canManage \?\s*\(\s*<div className="mt-6">\s*<SalonStoreProfileForm/);
  assert.match(profile, /閲覧のみの権限のため、店舗プロフィールの保存はできません/);
  const culture = strip("app/salon/stores/[storeId]/culture/page.tsx");
  assert.match(culture, /!st\.canEdit/);
  const stylists = strip("app/salon/stores/[storeId]/stylists/page.tsx");
  assert.match(stylists, /canManageStoreHiringHint/);
  assert.match(stylists, /canManage=\{canManage\}/);
});
