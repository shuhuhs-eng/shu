import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("0120/0121 の配線: 発行は app_metadata を付けて作成し、PDF取得APIは専用RPCで権限確認する", () => {
  const a = readFileSync("lib/admin/salon-issue-actions.ts", "utf8");
  assert.match(a, /app_metadata:\s*appMeta/);
  const r = readFileSync("app/api/manual-invoices/[documentId]/pdf/route.ts", "utf8");
  assert.match(r, /authorize_manual_invoice_document_download/);
  assert.match(r, /sha256Hex\(bytes\) !== doc\.data\.file_sha256/);
  const p = readFileSync("lib/admin/salon-signup-policy-actions.ts", "utf8");
  assert.match(p, /salonAccountIssueEnabled\(\)/); assert.match(p, /admin_set_salon_signup_policy/);
  const m = readFileSync("lib/invoices/manual-issue-actions.ts", "utf8");
  assert.match(m, /manualBillingEnabled\(\)/);
});
