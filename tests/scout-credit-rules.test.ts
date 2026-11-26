import test from "node:test";
import assert from "node:assert/strict";
import { canGrantInitial, isValidPurchaseQuantity, purchasePrice, campaignActive, campaignValid, INITIAL_GRANT } from "../lib/billing/scout-credit-rules";

test("初回10件は法人ごとに1回だけ", () => { assert.equal(INITIAL_GRANT, 10); assert.equal(canGrantInitial(false), true); assert.equal(canGrantInitial(true), false); });
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
