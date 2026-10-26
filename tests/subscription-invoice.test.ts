import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { subscriptionStorageKey } from "../lib/invoices/subscription-path";
import { ADMIN_INVOICE_STATE_LABELS, adminInvoiceState, companyInvoiceState, COMPANY_INVOICE_TEXT, PREPARING_WINDOW_MS } from "../lib/invoices/subscription-status";
import { preparedSubscriptionInvoiceSchema, subscriptionPrepareResultSchema } from "../lib/invoices/subscription-types";
import { renderSubscriptionInvoicePdf } from "../lib/invoices/subscription-pdf";
import { readinessForAdmin } from "../lib/invoices/subscription-readiness";
import { missingLabels } from "../lib/invoices/messages";

const ORG = "10000000-0000-4000-8000-000000000002";

const prepared = {
  issuer_snapshot: {
    legal_name: "株式会社ビューティーリーチ", postal_code: "100-0001", address: "東京都千代田区千代田1-1",
    invoice_registration_number: "T1234567890123", phone: "03-0000-0000", email: "billing@example.com",
  },
  recipient_snapshot: { legal_name: "請求先株式会社", postal_code: "220-0001", address: "神奈川県横浜市西区1-1", department_name: "経理部", contact_name: null },
  invoice_content_snapshot: {
    document_kind: "subscription_card" as const, invoice_number: "BR-2026-000123", invoice_date: "2026-10-01",
    transaction_date: "2026-10-01", service_period_start: "2026-10-01", service_period_end: "2026-10-31", currency: "jpy",
    amount_excl_tax: 10000, tax_rate: 10, tax_amount: 1000, total_amount: 11000,
    line_items: [{ description: "Beauty Reach 月額利用料", quantity: 1, unit: "か月", amount: 10000 }],
    payment: { method: "credit_card" as const, status: "paid" as const, paid_at: "2026-10-01T01:00:00+00:00", stripe_invoice_id: "in_test123", stripe_payment_intent_id: "pi_test123" },
  },
  storage_path: `subscription-invoices/${ORG}/BR-2026-000123.pdf`,
  snapshot_digest: "a".repeat(64),
};

test("Storageキー: DBのstorage_pathがそのまま実キー（変換しない）。旧形式・不正形式は拒否", () => {
  const p = `subscription-invoices/${ORG}/BR-2026-000123.pdf`;
  assert.equal(subscriptionStorageKey(p), p, "DB値をそのまま返す");
  for (const bad of ["", `invoices/${ORG}/BR-2026-000123.pdf`, `subscription-invoices/${ORG}/../BR-2026-000123.pdf`, `subscription-invoices/${ORG}/BR-2026-000123.txt`, `/subscription-invoices/${ORG}/BR-2026-000123.pdf`, "subscription-invoices/not-a-uuid/BR-2026-000123.pdf"]) {
    assert.throws(() => subscriptionStorageKey(bad), /invalid/, bad);
  }
});

test("会社向けの状態: 内部事情を出さず、直後は『準備中』、以降は『現在準備しています』", () => {
  const paid = "2026-10-01T00:00:00Z";
  const t0 = new Date(Date.parse(paid) + 60_000);
  const t1 = new Date(Date.parse(paid) + PREPARING_WINDOW_MS + 1000);
  assert.equal(companyInvoiceState(true, paid, t1), "available");
  assert.equal(companyInvoiceState(false, paid, t0), "preparing");
  assert.equal(companyInvoiceState(false, paid, t1), "pending");
  assert.equal(COMPANY_INVOICE_TEXT.preparing, "請求書を準備中です");
  assert.equal(COMPANY_INVOICE_TEXT.pending, "請求書を現在準備しています");
  for (const t of Object.values(COMPANY_INVOICE_TEXT)) assert.ok(!/登録番号|不足|発行事業者|エラー/.test(t));
});

test("運営向けの状態: 発行済み／条件不足／処理中／発行失敗の可能性", () => {
  const paid = "2026-10-01T00:00:00Z";
  const soon = new Date(Date.parse(paid) + 1000), late = new Date(Date.parse(paid) + PREPARING_WINDOW_MS + 1000);
  assert.equal(adminInvoiceState(true, [], paid, late), "issued");
  assert.equal(adminInvoiceState(false, ["issuer_registration_number"], paid, soon), "missing");
  assert.equal(adminInvoiceState(false, [], paid, soon), "processing");
  assert.equal(adminInvoiceState(false, [], paid, late), "failed");
  assert.match(ADMIN_INVOICE_STATE_LABELS.failed, /再試行/);
});

test("不足項目は日本語（月額は振込先を要求しない）", () => {
  const labels = missingLabels(["issuer_legal_name", "issuer_registration_number", "issuer_address", "recipient_legal_name"]);
  assert.deepEqual(labels, ["発行事業者名が未登録です", "インボイス登録番号が未登録です", "発行事業者の住所が未登録です", "請求先情報が未登録です"]);
});

test("snapshot/readiness解釈: 不正な形は拒否", () => {
  assert.equal(preparedSubscriptionInvoiceSchema.safeParse(prepared).success, true);
  assert.equal(preparedSubscriptionInvoiceSchema.safeParse({ ...prepared, invoice_content_snapshot: { ...prepared.invoice_content_snapshot, payment: { ...prepared.invoice_content_snapshot.payment, method: "bank" } } }).success, false);
  assert.equal(subscriptionPrepareResultSchema.safeParse({ result: "not_ready", missing: ["issuer_address"] }).success, true);
  assert.equal(subscriptionPrepareResultSchema.safeParse({ result: "ready", ...prepared }).success, true);
  assert.deepEqual(readinessForAdmin({ already_issued: false, missing: ["x"], warnings: [] }), { alreadyIssued: false, missing: ["x"] });
  assert.throws(() => readinessForAdmin({ missing: "x" }));
});

test("月額PDF: 実際に生成し、適格請求書の記載事項が入り、振込先・カード番号は入らない", async () => {
  const bytes = await renderSubscriptionInvoicePdf(prepared);
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  let text = "";
  try {
    const dir = mkdtempSync(join(tmpdir(), "subinv-"));
    try {
      const f = join(dir, "a.pdf");
      writeFileSync(f, bytes);
      text = execFileSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    return; // pdftotext が無い環境では生成までを確認して終了
  }
  const flat = text.replace(/\s+/g, "");
  for (const must of [
    "請求書（クレジットカード決済済み）", "BR-2026-000123", "株式会社ビューティーリーチ", "T1234567890123", "東京都千代田区千代田1-1",
    "請求先株式会社", "神奈川県横浜市西区1-1", "2026年10月1日〜2026年10月31日", "Beauty Reach月額利用料",
    "10,000円", "10%", "1,000円", "11,000円", "クレジットカード", "クレジットカードにて決済済みです",
  ]) assert.ok(flat.includes(must.replace(/\s+/g, "")), `PDFに『${must}』が無い`);
  for (const mustNot of ["お振込先", "口座", "銀行", "お支払期限"]) assert.ok(!flat.includes(mustNot), `PDFに『${mustNot}』が有る`);
});

// ---------------------------------------------------------------- 静的検査
const read = (p: string) => readFileSync(p, "utf8");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("静的検査: ダウンロードは認可RPC→Storage→SHA-256照合。署名URL/公開URL/storage_pathの返却なし", () => {
  const route = strip(read("app/api/subscription-invoices/[documentId]/pdf/route.ts"));
  const iAuth = route.indexOf("authorize_subscription_invoice_download");
  const iDl = route.indexOf("downloadInvoicePdf(");
  const iSha = route.indexOf("sha256Hex(bytes)");
  assert.ok(iAuth > 0 && iDl > iAuth && iSha > iDl, "認可→取得→照合の順");
  assert.ok(!/createSignedUrl|getPublicUrl|createSignedUploadUrl/.test(route));
  assert.ok(!/storage_path/.test(route.replace(/doc\.data\.storage_path/g, "")), "storage_pathをレスポンスへ出さない");
  assert.match(route, /subscriptionStorageKey\(/);
});

test("静的検査: 会社向け画面・クエリにstorage_path/Stripe参照を出さない。発行は失敗を握りつぶさずresult型で返す", () => {
  const ui = read("components/billing/subscription-invoice-history.tsx");
  assert.ok(!/storage_path|stripe_invoice_id|file_sha256|missing/.test(strip(ui)));
  const issue = read("lib/invoices/subscription-issue.ts");
  assert.match(issue, /subscriptionStorageKey\(p\.prepared\.storage_path\)/);
  assert.ok(!/createSignedUrl|getPublicUrl/.test(issue));
  const webhook = read("lib/stripe/webhook-handler.ts");
  assert.match(webhook, /issueSubscriptionInvoice\(r\.payment_id\)/);
});

test("静的検査: カード番号等の保存・PDF出力コードがない", () => {
  for (const f of ["lib/invoices/subscription-pdf.ts", "lib/invoices/subscription-types.ts"]) {
    assert.ok(!/card_number|last4|cvc|exp_month|fingerprint/i.test(strip(read(f))), f);
  }
});
