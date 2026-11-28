import test from "node:test";
import assert from "node:assert/strict";
import { canGrantInitial, isValidPurchaseQuantity, purchasePrice, campaignActive, campaignValid, REGISTRATION_PLANS, isRegistrationPlan, lastValidDay, PURCHASE_TERMS_NOTE } from "../lib/billing/scout-credit-rules";

test("初回付与は法人ごとに1回だけ", () => { assert.equal(canGrantInitial(false), true); assert.equal(canGrantInitial(true), false); });
test("登録区分: 通常=税込33,000円・初回10件／キャンペーン=0円・初回5件", () => {
  assert.deepEqual(REGISTRATION_PLANS.standard, { label: "通常登録", feeInclTax: 33000, initialGrant: 10 });
  assert.deepEqual(REGISTRATION_PLANS.campaign, { label: "キャンペーン登録", feeInclTax: 0, initialGrant: 5 });
  assert.equal(isRegistrationPlan("standard"), true); assert.equal(isRegistrationPlan("campaign"), true);
  for (const v of ["", "free", "STANDARD", null, undefined, 1]) assert.equal(isRegistrationPlan(v), false);
});
test("購入分の最後に使える日: 購入日（日本時間）から1年間", () => {
  assert.equal(lastValidDay(new Date("2026-11-28T15:00:00+09:00")), "2027-11-27");
  assert.equal(lastValidDay(new Date("2026-11-27T16:00:00Z")), "2027-11-27");   // UTC 11/27 16:00 = JST 11/28 1:00
  assert.equal(lastValidDay(new Date("2026-11-27T14:59:00Z")), "2027-11-26");   // JST 11/27 23:59
  assert.equal(lastValidDay(new Date("2028-02-29T12:00:00+09:00")), "2029-02-27");  // うるう日は翌年の2/28に失効 → 最後は2/27
  assert.equal(lastValidDay(new Date("2026-01-01T00:00:00+09:00")), "2026-12-31");
});
test("購入の注意書き: 税込11,000円・1年有効・失効・原則返金不可", () => { for (const w of ["税込11,000円", "1年間有効", "失効", "返金は原則できません"]) assert.ok(PURCHASE_TERMS_NOTE.includes(w), w); });
test("購入は10件単位・10,000円（税抜）、税10%", () => {
  assert.deepEqual(purchasePrice(10), { fee: 10000, tax: 1000, total: 11000 }); assert.deepEqual(purchasePrice(30), { fee: 30000, tax: 3000, total: 33000 });
  for (const q of [0, 5, 15, -10, 10.5, NaN, 10010]) assert.equal(isValidPurchaseQuantity(q), false);
  assert.throws(() => purchasePrice(15));
});
test("キャンペーンの有効期間は開始日・終了日を含む（日本時間の暦日）。設定の検査", () => {
  const c = { quantity: 20, priceExclTax: 15000, startsOn: "2026-12-01", endsOn: "2026-12-31" };
  assert.equal(campaignActive(c, "2026-11-30"), false); assert.equal(campaignActive(c, "2026-12-01"), true); assert.equal(campaignActive(c, "2026-12-31"), true); assert.equal(campaignActive(c, "2027-01-01"), false);
  assert.equal(campaignValid(c), true); assert.equal(campaignValid({ ...c, startsOn: "2027-01-01" }), false); assert.equal(campaignValid({ ...c, quantity: 0 }), false);
});
