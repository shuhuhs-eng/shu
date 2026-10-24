import test from "node:test";
import assert from "node:assert/strict";
import { paymentState, overdueDays, countPaymentStates, PAYMENT_STATE_LABELS } from "../lib/billing/payment";
import { feeStatusLabel, availableFeeActions, jstToday, standardDueDate, formatYen } from "../lib/billing/format";

test("paymentState: invoiced は支払期限が今日より前なら overdue", () => {
  assert.equal(paymentState({ fee_status: "invoiced", due_date: "2026-10-01" }, "2026-10-02"), "overdue");
});
test("paymentState: 期限当日は overdue ではなく unpaid", () => {
  assert.equal(paymentState({ fee_status: "invoiced", due_date: "2026-10-02" }, "2026-10-02"), "unpaid");
});
test("paymentState: 旧請求(期限なし)は unpaid", () => {
  assert.equal(paymentState({ fee_status: "invoiced", due_date: null }, "2026-10-02"), "unpaid");
});
test("paymentState: 他の状態の写像", () => {
  assert.equal(paymentState({ fee_status: "pending_confirmation", due_date: null }, "2026-10-02"), "pre_invoice");
  assert.equal(paymentState({ fee_status: "confirmed", due_date: null }, "2026-10-02"), "pre_invoice");
  assert.equal(paymentState({ fee_status: "paid", due_date: "2020-01-01" }, "2026-10-02"), "paid");
  assert.equal(paymentState({ fee_status: "waived", due_date: null }, "2026-10-02"), "closed");
  assert.equal(paymentState({ fee_status: "cancelled", due_date: null }, "2026-10-02"), "closed");
});
test("overdueDays と集計", () => {
  assert.equal(overdueDays("2026-09-30", "2026-10-03"), 3);
  assert.equal(overdueDays("2026-10-03", "2026-10-03"), 0);
  assert.equal(overdueDays(null, "2026-10-03"), 0);
  const c = countPaymentStates(
    [
      { fee_status: "invoiced", due_date: "2026-09-01" },
      { fee_status: "invoiced", due_date: "2026-12-01" },
      { fee_status: "paid", due_date: null },
    ],
    "2026-10-03",
  );
  assert.deepEqual(c, { pre_invoice: 0, unpaid: 1, overdue: 1, paid: 1, closed: 0 });
});
test("請求状態ラベル: 内部名を出さない", () => {
  assert.equal(feeStatusLabel("invoiced"), "請求済み");
  assert.equal(feeStatusLabel("unknown_status"), "確認中");
  for (const label of Object.values(PAYMENT_STATE_LABELS)) assert.ok(!/[a-z_]{4,}/.test(label));
});
test("運営者が実行できる操作は DB の遷移規則どおり", () => {
  assert.deepEqual(availableFeeActions("invoiced"), ["paid", "cancel"]);
  assert.ok(!availableFeeActions("paid").includes("cancel"));
});
test("日付ヘルパー", () => {
  assert.equal(jstToday(new Date("2026-10-02T16:00:00Z")), "2026-10-03"); // JST は +9h
  assert.match(standardDueDate("2026-10-03"), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(formatYen(null), "未確定");
});
