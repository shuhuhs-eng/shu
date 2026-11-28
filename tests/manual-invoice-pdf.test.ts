import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderInvoicePdf } from "../lib/invoices/pdf";
import { issueManualInvoicePdf, type ManualIssueDeps } from "../lib/invoices/manual-issue-flow";

const ORG = "10000000-0000-4000-8000-000000000002";
const prepared = (label: string, desc: string) => ({
  issuer_snapshot: { legal_name: "株式会社ビューティーリーチ", postal_code: "100-0001", address: "東京都千代田区千代田1-1", invoice_registration_number: "T1234567890123", phone: "03-0000-0000", email: "billing@example.com",
    bank: { bank_name: "テスト銀行", branch_name: "本店", account_type: "ordinary", account_number: "1234567", account_holder: "カ）ビューティーリーチ" } },
  recipient_snapshot: { legal_name: "請求先株式会社", postal_code: "220-0001", address: "神奈川県横浜市西区1-1", department_name: null, contact_name: null },
  invoice_content_snapshot: { invoice_number: "BR-2026-000321", invoice_date: "2026-11-28", due_date: "2026-12-12", currency: "JPY", fee_amount: 50000, tax_rate: 10, tax_amount: 5000, total_amount: 55000, store_name: "渋谷店", hired_date: "2026-11-20", transaction_label: label,
    line_items: [{ description: desc, store_name: "渋谷店", hired_date: "2026-11-20", transaction_label: label, quantity: 1, unit: "件", amount: 50000 }] },
  storage_path: `invoices/${ORG}/BR-2026-000321.pdf`, snapshot_digest: "a".repeat(64),
});
function pdfText(bytes: Uint8Array): string | null {
  const dir = mkdtempSync(join(tmpdir(), "mpdf-"));
  try { const f = join(dir, "a.pdf"); writeFileSync(f, bytes); return execFileSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" }); } catch { return null; } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("手動請求のPDF: 見学・体験料（税抜50,000・税込55,000・実施日・振込先・登録番号）", async () => {
  const bytes = await renderInvoicePdf(prepared("実施日", "見学・体験入店料") as never);
  assert.ok(bytes.length > 1000);
  const t = pdfText(bytes); if (t === null) return;   // pdftotext が無い環境では描画成功のみ確認
  for (const w of ["BR-2026-000321", "見学・体験入店料", "実施日", "55,000", "50,000", "5,000", "1234567", "T1234567890123"]) assert.ok(t.includes(w), `PDFに「${w}」が無い`);
  assert.ok(!t.includes("採用成立日"));
});
test("既存の成功報酬PDF（ラベル無し）は従来どおり「採用成立日」と表示", async () => {
  const p = prepared("x", "美容師採用成功報酬") as never as { invoice_content_snapshot: { transaction_label?: string; line_items: { transaction_label?: string }[] } };
  delete p.invoice_content_snapshot.transaction_label; delete p.invoice_content_snapshot.line_items[0].transaction_label;
  const t = pdfText(await renderInvoicePdf(p as never)); if (t === null) return;
  assert.ok(t.includes("採用成立日"));
});

// ---- 発行の流れ（DB・Storageは差し替え）
type Call = string;
function deps(opts: { ready?: object; registerError?: string; conflict?: boolean; alreadyAfterFail?: boolean } = {}) {
  const calls: Call[] = [];
  const ready = { ready: true, already_issued: false, missing: [], warnings: [], ...(opts.ready ?? {}) };
  const d: ManualIssueDeps = {
    rpc: async (fn) => {
      calls.push("rpc:" + fn);
      if (fn === "admin_manual_invoice_pdf_readiness") return { data: calls.filter((c) => c === "rpc:admin_manual_invoice_pdf_readiness").length > 1 && opts.alreadyAfterFail ? { ...ready, already_issued: true, ready: false } : ready, error: null };
      if (fn === "admin_manual_invoice_pdf_prepare") return { data: prepared("実施日", "見学・体験入店料"), error: null };
      if (opts.registerError) return { data: null, error: { message: opts.registerError } };
      return { data: { document_id: "20000000-0000-4000-8000-000000000001", invoice_number: "BR-2026-000321" }, error: null };
    },
    render: async () => { calls.push("render"); return new Uint8Array([1, 2, 3]); },
    sha256: () => "b".repeat(64),
    ensureBucket: async () => true,
    upload: async () => { calls.push("upload"); return opts.conflict ? { ok: false as const, conflict: true } : { ok: true as const }; },
    ageMs: async () => 1000, remove: async () => { calls.push("remove"); },
  };
  return { d, calls };
}
test("発行事業者・振込先が未設定なら、PDFを作らず保存もしない（不足項目を日本語で返す）", async () => {
  const { d, calls } = deps({ ready: { ready: false, missing: ["issuer_bank_name_missing", "issuer_registration_number", "recipient_legal_name"] } });
  const r = await issueManualInvoicePdf(d, "i1");
  assert.equal(r.success, false);
  assert.ok(!r.success && r.missing?.some((m) => m.includes("銀行名")) && r.missing.some((m) => m.includes("インボイス登録番号")) && r.missing.some((m) => m.includes("請求先")));
  assert.ok(!calls.includes("render") && !calls.includes("upload") && !calls.includes("rpc:admin_manual_invoice_pdf_register"));
});
test("発行済みなら何もしない（二重発行しない）", async () => {
  const { d, calls } = deps({ ready: { ready: false, already_issued: true } });
  const r = await issueManualInvoicePdf(d, "i1"); assert.equal(r.success, true);
  assert.ok(!calls.includes("render") && !calls.includes("upload"));
});
test("正常: 確認→準備→描画→保存→記録の順", async () => {
  const { d, calls } = deps(); const r = await issueManualInvoicePdf(d, "i1");
  assert.equal(r.success, true);
  assert.deepEqual(calls, ["rpc:admin_manual_invoice_pdf_readiness", "rpc:admin_manual_invoice_pdf_prepare", "render", "upload", "rpc:admin_manual_invoice_pdf_register"]);
});
test("記録に失敗したら、保存したファイルを消す（発行されていない場合）", async () => {
  const { d, calls } = deps({ registerError: "boom" }); const r = await issueManualInvoicePdf(d, "i1");
  assert.equal(r.success, false); assert.ok(calls.includes("remove"));
});
test("記録の応答が失われても、実は発行済みならファイルを消さず成功とする", async () => {
  const { d, calls } = deps({ registerError: "network", alreadyAfterFail: true }); const r = await issueManualInvoicePdf(d, "i1");
  assert.equal(r.success, true); assert.ok(!calls.includes("remove"));
});
test("内容が変わっていたら、再発行を案内して止める", async () => {
  const { d } = deps({ registerError: "invoice snapshot has changed; regenerate the document" }); const r = await issueManualInvoicePdf(d, "i1");
  assert.ok(!r.success && r.error.includes("変更された"));
});
test("同名ファイルが新しい（発行中の可能性）なら上書きせず止める", async () => {
  const { d, calls } = deps({ conflict: true }); const r = await issueManualInvoicePdf(d, "i1");
  assert.equal(r.success, false); assert.ok(!calls.includes("rpc:admin_manual_invoice_pdf_register") && !calls.includes("remove"));
});
test("責任者以外はDBが拒否 → 責任者のみの案内", async () => {
  const d: ManualIssueDeps = { ...deps().d, rpc: async () => ({ data: null, error: { message: "responsible only" } }) };
  const r = await issueManualInvoicePdf(d, "i1"); assert.ok(!r.success && r.error.includes("責任者のみ"));
});
