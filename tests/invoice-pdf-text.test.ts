import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderSubscriptionInvoicePdf } from "../lib/invoices/subscription-pdf";

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

// ---------------------------------------------------------------- 半角英数字（電話番号等）のPDF表示
import { renderInvoicePdf } from "../lib/invoices/pdf";
function pdfText(bytes: Uint8Array): string | null {
  const dir = mkdtempSync(join(tmpdir(), "pdftxt-"));
  try {
    const f = join(dir, "a.pdf");
    writeFileSync(f, bytes);
    return execFileSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" });
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const PHONES = ["03-1234-5678", "0467-00-0000", "+81-3-1234-5678"];
const successFee = (phone: string) => ({
  issuer_snapshot: {
    legal_name: "株式会社テスト", postal_code: "100-0001", address: "東京都千代田区1-1", invoice_registration_number: "T9876543210987",
    phone, email: "billing-test@example.co.jp",
    bank: { bank_name: "テスト銀行", branch_name: "本店", account_type: "ordinary", account_number: "1234567", account_holder: "カ）テスト" },
  },
  recipient_snapshot: { legal_name: "請求先", postal_code: null, address: null, department_name: null, contact_name: null },
  invoice_content_snapshot: {
    invoice_number: "BR-2026-000045", invoice_date: "2026-10-01", due_date: "2026-10-31", currency: "jpy", fee_amount: 1000, tax_rate: 10, tax_amount: 100, total_amount: 1100,
    store_name: "S", hired_date: "2026-09-01", line_items: [{ description: "採用成功報酬", store_name: "S", hired_date: "2026-09-01", quantity: 1, unit: "名", amount: 1000 }],
  },
  storage_path: "x", snapshot_digest: "a".repeat(64),
});

test("PDFの半角英数字: 電話番号・メール・登録番号・BR番号が欠けず連続した文字列で抽出できる（月額・成功報酬の両方）", async () => {
  for (const phone of PHONES) {
    const sub = await renderSubscriptionInvoicePdf({ ...prepared, issuer_snapshot: { ...prepared.issuer_snapshot, phone, email: "billing-test@example.co.jp" } });
    const fee = await renderInvoicePdf(successFee(phone));
    for (const [name, bytes, num, reg] of [["月額", sub, "BR-2026-000123", "T1234567890123"], ["成功報酬", fee, "BR-2026-000045", "T9876543210987"]] as const) {
      const text = pdfText(bytes);
      if (text === null) return; // pdftotext が無い環境では生成までを確認
      for (const must of [`TEL ${phone}`, "billing-test@example.co.jp", reg, num]) {
        assert.ok(text.includes(must), `${name}PDFに『${must}』が連続して存在しない`);
      }
    }
  }
});

test("PDF共通: 日本語フォントのlocl(数字の代替字形)を無効化している", () => {
  for (const f of ["lib/invoices/pdf.ts", "lib/invoices/subscription-pdf.ts"]) {
    assert.match(readFileSync(f, "utf8"), /features: INVOICE_FONT_FEATURES/, f);
  }
});
