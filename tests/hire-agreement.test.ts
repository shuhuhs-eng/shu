import test from "node:test";
import assert from "node:assert/strict";
import { agreementActions, hireErrorMessage, isRealDate, isOpenAgreement, UNDECIDED_NOTES, AGREEMENT_STATUS_LABELS } from "../lib/billing/hire-agreement";
import { hireBillingEnabled, scoutLedgerEnabled } from "../lib/billing/hire-flags";
import { ENTRY_LABELS, POOL_LABELS } from "../lib/billing/ledger";

test("意思確認の記録は運営（スタッフ含む）、代理・変更・辞退/取消は責任者のみ", () => {
  assert.equal(agreementActions("awaiting_intent", false, false).recordIntent, true);
  assert.equal(agreementActions("awaiting_intent", true, false).close, true);
  assert.equal(agreementActions("awaiting_salon", false, true).proxyConfirm, false);
  assert.equal(agreementActions("awaiting_salon", true, false).proxyConfirm, false);   // 7日前は不可（自動確定もしない）
  assert.equal(agreementActions("awaiting_salon", true, true).proxyConfirm, true);
  assert.equal(agreementActions("confirmed", true, false).changePlan, true);
  assert.equal(agreementActions("awaiting_salon", true, false).changePlan, true);   // 内定前の変更は版が変わり、サロンの古い画面を無効にする
  assert.equal(agreementActions("confirmed", true, true).proxyConfirm, true);   // 条件変更後の再確認の代理（待機はDBが判定）
  assert.equal(agreementActions("confirmed", false, true).proxyConfirm, false);
  assert.equal(agreementActions("confirmed", false, false).changePlan, false);
  assert.equal(agreementActions("confirmed", false, false).close, false);
  assert.deepEqual(agreementActions("declined", true, true), { recordIntent: false, proxyConfirm: false, changePlan: false, close: false, switchToLegacy: true });   // 請求予定が無い取消済み契約は、責任者が旧方式へ切替できる
  assert.equal(agreementActions("declined", true, false, "cancelled").switchToLegacy, true);   // D4: 請求前の取消で請求予定が取り消された後も、旧経路へは自動で戻らない。切替は別の明示操作
  assert.equal(agreementActions("declined", false, false, "cancelled").switchToLegacy, false);   // 責任者のみ
  assert.equal(agreementActions("declined", true, false, "charging").switchToLegacy, false);   // 請求が始まった契約は切替不可（返金確認へ）
  assert.equal(agreementActions("declined", true, false, "charged").switchToLegacy, false);
  assert.equal(agreementActions("declined", true, false, "cancelled", true).switchToLegacy, false);   // 切替済みなら再表示しない
  assert.equal(agreementActions("confirmed", true, false, "scheduled").switchToLegacy, false);
  assert.equal(isOpenAgreement("cancelled"), false);
});
test("実在する日付だけを受け付ける", () => {
  assert.equal(isRealDate("2027-04-01"), true);
  assert.equal(isRealDate("2027-02-30"), false);
  assert.equal(isRealDate("2027-4-1"), false);
  assert.equal(isRealDate(""), false);
});
test("DBのエラーを利用者向けの文言に直す（内部の語を出さない）", () => {
  assert.ok(hireErrorMessage("waiting period has not elapsed").includes("7日"));
  assert.ok(hireErrorMessage("insufficient permission (responsible only)").includes("責任者のみ"));
  assert.equal(hireErrorMessage("some internal error xyz"), "処理を完了できませんでした。時間をおいて再度お試しください。");
  assert.ok(hireErrorMessage(null).includes("処理を完了できませんでした"));
});
test("役職の判定元などの未決定事項を明示する文言がある", () => {
  assert.ok(UNDECIDED_NOTES.hire_fee_role_source.includes("未決定"));
  assert.equal(AGREEMENT_STATUS_LABELS.not_opened, "契約未作成");
});
test("機能フラグは既定オフ・'1'のときだけオン", () => {
  assert.equal(hireBillingEnabled({}), false); assert.equal(hireBillingEnabled({ HIRE_BILLING_ENABLED: "true" }), false); assert.equal(hireBillingEnabled({ HIRE_BILLING_ENABLED: "1" }), true);
  assert.equal(scoutLedgerEnabled({}), false); assert.equal(scoutLedgerEnabled({ SCOUT_LEDGER_ENABLED: "1" }), true);
});
test("台帳の表示ラベル", () => {
  assert.ok(ENTRY_LABELS.consume.includes("消費")); assert.equal(POOL_LABELS.free, "無料分"); assert.equal(POOL_LABELS.paid, "購入分");
});
test("古い画面・金額違い・新旧の重なりのDBエラーを、再読み込みを促す文言にする", () => {
  assert.ok(hireErrorMessage("stale agreement revision").includes("読み込み直して"));
  assert.ok(hireErrorMessage("confirmed amount does not match the current fee").includes("金額"));
  assert.ok(hireErrorMessage("confirmed terms do not match the agreement").includes("読み込み直して"));
  assert.ok(hireErrorMessage("another fee already exists for this hire (legacy_fee)").includes("二重請求"));
  assert.ok(hireErrorMessage("terms changed after confirmation; reconfirmation required").includes("再確認"));
});
