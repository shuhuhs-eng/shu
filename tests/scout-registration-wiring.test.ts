import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registrationErrorMessage } from "../lib/billing/scout-registration-message";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("登録区分の設定: DBの拒否理由を利用者向けの文言にする（内部名を出さない）", () => {
  assert.match(registrationErrorMessage("registration class is locked after the initial grant"), /変更できません/);
  assert.match(registrationErrorMessage("insufficient permission (responsible only)"), /責任者のみ/);
  assert.match(registrationErrorMessage("boom: relation scout_ledger_entries"), /設定できませんでした/);
  assert.doesNotMatch(registrationErrorMessage("boom: relation scout_ledger_entries"), /scout_ledger|relation/);
});
test("登録区分の設定はサーバー側フラグ・責任者RPCを通る（フラグ未設定では何もしない）", () => {
  const s = read("lib/billing/scout-registration-actions.ts");
  assert.match(s, /scoutLedgerEnabled\(\)/); assert.match(s, /admin_scout_set_registration/); assert.match(s, /isRegistrationPlan/);
});
test("残高表示: 購入分の期限と初回付与前の案内を出し、「有効期限はありません」とは言わない", () => {
  const s = read("components/store-activity/scout-balance-card.tsx");
  assert.match(s, /next_expiry/); assert.match(s, /失効/); assert.match(s, /registration_set/);
  assert.doesNotMatch(s, /共通の残数です。有効期限はありません/);
});
test("購入画面の注意書きは台帳方式のときだけ出す", () => {
  assert.match(read("components/billing/payment-settings.tsx"), /scoutLedger \? PURCHASE_TERMS_NOTE/);
  assert.match(read("app/salon/company/billing/page.tsx"), /scoutLedger=\{scoutLedgerEnabled\(\)\}/);
});
test("運営画面: 台帳の法人ページに登録区分の設定がある", () => {
  const s = read("app/admin/scout-ledger/[orgId]/page.tsx");
  assert.match(s, /ScoutRegistrationForm/); assert.match(s, /loadRegistration/);
});
