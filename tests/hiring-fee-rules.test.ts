import test from "node:test";
import assert from "node:assert/strict";
import { hiringFeeAmounts, chargeDateFor, isChargeDue, stageChargesFee, canProxyConfirm } from "../lib/billing/hiring-fee-rules";

test("金額: スタイリスト550,000円・アシスタント450,000円（税抜）、税10%", () => {
  assert.deepEqual(hiringFeeAmounts("stylist"), { fee: 550000, tax: 55000, total: 605000 });
  assert.deepEqual(hiringFeeAmounts("assistant"), { fee: 450000, tax: 45000, total: 495000 });
});
test("請求日は入社予定日の翌日（月末・年末・うるう日をまたぐ）", () => {
  assert.equal(chargeDateFor("2026-12-31"), "2027-01-01"); assert.equal(chargeDateFor("2028-02-28"), "2028-02-29"); assert.equal(chargeDateFor("2027-02-28"), "2027-03-01");
  assert.throws(() => chargeDateFor("2027-02-30")); assert.throws(() => chargeDateFor("bad"));
});
test("内定確定では請求しない／入社予定日の翌日から請求対象", () => {
  assert.equal(stageChargesFee("offer_confirmed"), false);
  assert.equal(isChargeDue("2027-04-01", "2027-04-01"), false); assert.equal(isChargeDue("2027-04-01", "2027-04-02"), true);
  assert.equal(isChargeDue("2027-04-01", "2027-04-09", "cancelled"), false); assert.equal(isChargeDue("2027-04-01", "2027-04-09", "declined"), false);
});
test("代理操作: 入社意思確認の完了から7日後・サロン未操作・責任者のみ", () => {
  const t0 = new Date("2026-12-01T00:00:00Z"), d = (n: number) => new Date(t0.getTime() + n * 86400000);
  assert.equal(canProxyConfirm(t0, false, d(6.99), true).reason, "waiting_period");
  assert.equal(canProxyConfirm(t0, false, d(7), true).ok, true);
  assert.equal(canProxyConfirm(null, false, d(30), true).reason, "stylist_intent_not_confirmed");
  assert.equal(canProxyConfirm(t0, true, d(30), true).reason, "salon_already_acted");
  assert.equal(canProxyConfirm(t0, false, d(30), false).reason, "responsible_only");
});
