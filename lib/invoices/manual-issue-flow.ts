import { missingLabels } from "./messages";
import { z } from "zod";
import { preparedInvoiceSchema, registeredSchema, type InvoiceActionResult } from "./types";

/** 手動請求の発行可否（DBの admin_manual_invoice_pdf_readiness の戻り値）。 */
export const manualReadinessSchema = z.object({
  ready: z.boolean(), already_issued: z.boolean(), missing: z.array(z.string()), warnings: z.array(z.string()),
  document_id: z.string().uuid().nullish(), generated_at: z.string().nullish(),
});

/**
 * 手動請求の請求書PDF発行の流れ（既存の成功報酬の発行と同じ順序：確認 → snapshot → PDF → 保存 → 記録）。
 * ★発行事業者・振込先・請求先が未設定なら、DBが missing を返し、ここでPDFを作らずに止める。
 * ★記録に失敗したらアップロードしたファイルを消す（ただし「実は記録されていた」場合は消さない）。
 */
export type ManualIssueDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
  render: (prepared: ReturnType<typeof preparedInvoiceSchema.parse>) => Promise<Uint8Array>;
  sha256: (b: Uint8Array) => string;
  ensureBucket: () => Promise<boolean>;
  upload: (path: string, b: Uint8Array) => Promise<{ ok: true } | { ok: false; conflict: boolean }>;
  ageMs: (path: string) => Promise<number | null>;
  remove: (path: string) => Promise<void>;
};
export const ORPHAN_AGE_MS = 10 * 60 * 1000;
const GENERIC = "請求書PDFを発行できませんでした。時間をおいて再度お試しください。";

export async function issueManualInvoicePdf(d: ManualIssueDeps, invoiceId: string): Promise<InvoiceActionResult> {
  const r = await d.rpc("admin_manual_invoice_pdf_readiness", { p_invoice_id: invoiceId });
  if (r.error) return { success: false, error: /responsible only|insufficient permission/.test(r.error.message) ? "この操作は責任者のみ行えます。" : GENERIC };
  const ready = manualReadinessSchema.safeParse(r.data);
  if (!ready.success) return { success: false, error: GENERIC };
  if (ready.data.already_issued) return { success: true, message: "この請求書はすでに発行済みです。" };
  if (!ready.data.ready) return { success: false, error: "請求書を発行するために、次の項目を確認してください。", missing: missingLabels(ready.data.missing) };

  const p = await d.rpc("admin_manual_invoice_pdf_prepare", { p_invoice_id: invoiceId });
  if (p.error) return { success: false, error: GENERIC };
  const prepared = preparedInvoiceSchema.safeParse(p.data);
  if (!prepared.success) return { success: false, error: GENERIC };

  let bytes: Uint8Array;
  try { bytes = await d.render(prepared.data); } catch { return { success: false, error: "請求書PDFを作成できませんでした。時間をおいて再度お試しください。" }; }
  const sha = d.sha256(bytes); const path = prepared.data.storage_path;

  if (!(await d.ensureBucket())) return { success: false, error: "請求書の保存先を準備できませんでした。" };
  let up = await d.upload(path, bytes);
  if (!up.ok && up.conflict) {
    const age = await d.ageMs(path);
    if (age !== null && age > ORPHAN_AGE_MS) { await d.remove(path); up = await d.upload(path, bytes); }
    else return { success: false, error: "この請求書は別の操作で発行中の可能性があります。しばらくしてから画面を更新してください。" };
  }
  if (!up.ok) return { success: false, error: "請求書PDFを保存できませんでした。時間をおいて再度お試しください。" };

  const reg = await d.rpc("admin_manual_invoice_pdf_register", { p_invoice_id: invoiceId, p_snapshot_digest: prepared.data.snapshot_digest, p_file_sha256: sha });
  if (reg.error || !registeredSchema.safeParse(reg.data).success) {
    const after = await d.rpc("admin_manual_invoice_pdf_readiness", { p_invoice_id: invoiceId });
    const again = manualReadinessSchema.safeParse(after.data);
    if (again.success && again.data.already_issued) return { success: true, message: "請求書PDFを発行しました。" };
    await d.remove(path);
    return { success: false, error: reg.error?.message.includes("snapshot has changed") ? "請求内容が変更されたため発行できませんでした。画面を更新してもう一度お試しください。" : GENERIC };
  }
  return { success: true, message: "請求書PDFを発行しました。" };
}
