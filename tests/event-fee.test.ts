import test from "node:test";
import assert from "node:assert/strict";
import { canApplyFee, eventFeeAmounts, feeErrorMessage, FEE_STATUS_LABELS, type FeeStatus } from "../lib/billing/event-fee";

test("金額は税抜50,000円・税5,000円・税込55,000円", () => assert.deepEqual(eventFeeAmounts(), { fee: 50000, tax: 5000, total: 55000 }));
test("責任者以外は全操作不可", () => {
  for (const s of Object.keys(FEE_STATUS_LABELS) as FeeStatus[]) for (const a of ["start_payment", "resolve_unknown", "cancel"] as const)
    assert.deepEqual(canApplyFee(s, a, false), { ok: false, reason: "responsible_only" });
});
test("結果不明は新しい決済も取消もできず、確認の記録だけ可能", () => {
  assert.equal(canApplyFee("payment_unknown", "start_payment", true).ok, false);
  assert.equal(canApplyFee("payment_unknown", "cancel", true).ok, false);
  assert.equal(canApplyFee("payment_unknown", "resolve_unknown", true).ok, true);
});
test("決済中・支払い済み・取消・失敗後は新しい決済を開始できない", () => {
  for (const s of ["payment_in_progress", "paid", "cancelled"] as const) assert.equal(canApplyFee(s, "start_payment", true).ok, false);
  assert.equal(canApplyFee("payment_failed", "start_payment", true).ok, false, "再試行条件が未決定の間は失敗後の再開始を許さない");
  assert.equal(canApplyFee("payment_failed", "cancel", true).ok, true);
  assert.equal(canApplyFee("paid", "cancel", true).ok, false);
});
test("再試行・確認内容などの例外文言", () => {
  assert.match(feeErrorMessage("retry after failure is not allowed until the retry policy is decided"), /再試行の条件が決まるまで/);
  assert.match(feeErrorMessage("confirmation note required (x)"), /確認内容/);
  assert.match(feeErrorMessage("paid must be explicitly true or false"), /入金の有無/);
});
test("DBの例外文言を利用者向け文言へ（内部文言を出さない）", () => {
  assert.match(feeErrorMessage("unknown payment result must be resolved before a new attempt"), /結果が不明/);
  assert.match(feeErrorMessage("insufficient permission (responsible only)"), /責任者/);
  assert.doesNotMatch(feeErrorMessage("relation visit_fee_charges xyz"), /visit_fee_charges/);
});
