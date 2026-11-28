import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isFilter, manualBillingErrorMessage, statusLabel, yen } from "../lib/billing/manual-billing";
import { manualBillingEnabled, salonAccountIssueEnabled, hireBillingEnabled } from "../lib/billing/hire-flags";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "");   // コメントを除いたコード
test("新しい機能フラグは既定オフ。'1' だけが有効（他の値・未設定は無効）で、採用料の自動請求のフラグとは独立", () => {
  for (const v of [undefined, "", "0", "true", "on", "2"]) { assert.equal(manualBillingEnabled({ MANUAL_BILLING_ENABLED: v }), false); assert.equal(salonAccountIssueEnabled({ SALON_ACCOUNT_ISSUE_ENABLED: v }), false); }
  assert.equal(manualBillingEnabled({ MANUAL_BILLING_ENABLED: "1" }), true); assert.equal(salonAccountIssueEnabled({ SALON_ACCOUNT_ISSUE_ENABLED: "1" }), true);
  assert.equal(hireBillingEnabled({ MANUAL_BILLING_ENABLED: "1", SALON_ACCOUNT_ISSUE_ENABLED: "1" }), false);
});
test("状態の表示と絞り込み", () => {
  assert.equal(statusLabel({ status: "issued", overdue: false, paid_total: 0 }), "請求済み（未入金）"); assert.equal(statusLabel({ status: "issued", overdue: false, paid_total: 100 }), "請求済み（一部入金）");
  assert.equal(statusLabel({ status: "issued", overdue: true, paid_total: 0 }), "請求済み・期限超過（未入金）"); assert.equal(statusLabel({ status: "paid", overdue: false, paid_total: 1 }), "入金済み"); assert.equal(statusLabel({ status: "void", overdue: false, paid_total: 0 }), "取消");
  assert.equal(isFilter("overdue"), true); for (const v of ["", "x", null, undefined]) assert.equal(isFilter(v), false); assert.equal(yen(33000), "33,000円");
});
test("DBの拒否理由を操作者向けの文言にする。超過入金・二重記録は自動で受け付けない旨を示し、内部名を出さない", () => {
  assert.match(manualBillingErrorMessage("amount exceeds outstanding"), /受け付けられません/);
  assert.match(manualBillingErrorMessage("duplicate payment record"), /二重記録/);
  assert.match(manualBillingErrorMessage("only an unpaid open invoice can be voided"), /先に入金の記録を取り消して/);
  const g = manualBillingErrorMessage("relation manual_invoices does not exist"); assert.doesNotMatch(g, /manual_invoices|relation/); assert.match(g, /完了できませんでした/);
});
test("操作はサーバー側フラグ・責任者RPCを通り、Stripe・カード・自動請求の設定には触れない", () => {
  const a = code("lib/billing/manual-billing-actions.ts");
  assert.match(a, /manualBillingEnabled\(\)/); assert.doesNotMatch(a, /stripe|auto_charge|billing_setting/i);
  for (const fn of ["admin_manual_invoice_create", "admin_manual_invoice_record_payment", "admin_manual_invoice_reverse_payment", "admin_manual_invoice_void"]) assert.match(a, new RegExp(fn));
  for (const p of ["app/admin/manual-billing/page.tsx", "app/admin/manual-billing/[id]/page.tsx"]) { const s = read(p); assert.match(s, /requireAdminPage/); assert.match(s, /manualBillingEnabled\(\)/); }
});
test("ナビ: 手動請求は責任者のみ・フラグ有効時だけ表示", () => { const s = read("components/admin/admin-nav.tsx"); assert.match(s, /manualBillingEnabled\(\) && variant !== "staff"/); });
test("アカウント発行: フラグ・責任者ページ・登録料の決済なし", () => {
  const a = code("lib/admin/salon-issue-actions.ts"); assert.match(a, /salonAccountIssueEnabled\(\)/); assert.doesNotMatch(a, /stripe|checkout|payment/i);
  assert.match(read("app/admin/salons/issue/page.tsx"), /requireAdminPage/); assert.match(read("components/admin/salon-issue-form.tsx"), /本部が直接徴収/);
});
