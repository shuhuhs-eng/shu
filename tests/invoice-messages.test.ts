import test from "node:test";
import assert from "node:assert/strict";
import { missingLabel, missingLabels, needsIssuerSettings, needsRecipientProfile, bankAccountTypeLabel } from "../lib/invoices/messages";

test("不足コードは日本語になり、未知コードでも内部名を出さない", () => {
  assert.equal(missingLabel("due_date"), "支払期限が未設定です");
  const unknown = missingLabel("some_internal_code_xyz");
  assert.ok(!unknown.includes("some_internal_code_xyz"));
});
test("重複ラベルは1つにまとめる", () => {
  assert.equal(missingLabels(["due_date", "due_date"]).length, 1);
});
test("案内リンクの出し分け", () => {
  assert.equal(needsIssuerSettings(["issuer_address"]), true);
  assert.equal(needsIssuerSettings(["due_date"]), false);
  assert.equal(needsRecipientProfile(["recipient_legal_name"]), true);
});
test("口座種別ラベル", () => {
  assert.equal(bankAccountTypeLabel("ordinary"), "普通");
  assert.equal(bankAccountTypeLabel(null), "");
  assert.equal(bankAccountTypeLabel("zzz"), "");
});
