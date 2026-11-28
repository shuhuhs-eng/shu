"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { manualBillingEnabled } from "@/lib/billing/hire-flags";
import { manualBillingErrorMessage } from "@/lib/billing/manual-billing";

/** 手動請求・入金の記録。MANUAL_BILLING_ENABLED=1 のときだけ動く（既定オフ）。権限はDBが責任者のみで再確認する。★Stripe・カードには触れない。 */
type Result = { success: true; data?: unknown } | { success: false; error: string };
const uuid = z.string().uuid(); const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/); const text = (n: number) => z.string().trim().max(n);
async function call(fn: string, args: Record<string, unknown>, paths: string[]): Promise<Result> {
  if (!manualBillingEnabled()) return { success: false, error: "この機能はまだ有効になっていません。" };
  const supabase = (await createClient()) as unknown as Pick<SupabaseClient, "rpc">;
  const { data, error } = await supabase.rpc(fn, args);
  if (error) { console.error(`[${fn}]`, { code: error.code }); return { success: false, error: manualBillingErrorMessage(error.message) }; }
  for (const p of paths) revalidatePath(p);
  return { success: true, data };
}
const bad: Result = { success: false, error: "入力が正しくありません。" };
export async function createManualInvoice(i: { kind: string; sourceId: string; dueOn: string; note?: string }): Promise<Result> {
  const p = z.object({ kind: z.enum(["visit_fee", "hire_fee"]), sourceId: uuid, dueOn: day, note: text(500).optional() }).safeParse(i);
  return p.success ? call("admin_manual_invoice_create", { p_kind: p.data.kind, p_source_id: p.data.sourceId, p_due_on: p.data.dueOn, p_note: p.data.note || null }, ["/admin/manual-billing"]) : bad;
}
export async function recordManualPayment(i: { invoiceId: string; amount: number; receivedOn: string; method: string; reference?: string; note?: string }): Promise<Result> {
  const p = z.object({ invoiceId: uuid, amount: z.number().int().min(1).max(100_000_000), receivedOn: day, method: z.enum(["bank_transfer", "cash", "other"]), reference: text(200).optional(), note: text(500).optional() }).safeParse(i);
  return p.success ? call("admin_manual_invoice_record_payment", { p_invoice_id: p.data.invoiceId, p_amount: p.data.amount, p_received_on: p.data.receivedOn, p_method: p.data.method, p_reference: p.data.reference || null, p_note: p.data.note || null }, ["/admin/manual-billing", `/admin/manual-billing/${p.data.invoiceId}`]) : bad;
}
export async function reverseManualPayment(i: { invoiceId: string; paymentId: string; reason: string }): Promise<Result> {
  const p = z.object({ invoiceId: uuid, paymentId: uuid, reason: text(500).min(1) }).safeParse(i);
  return p.success ? call("admin_manual_invoice_reverse_payment", { p_payment_id: p.data.paymentId, p_reason: p.data.reason }, ["/admin/manual-billing", `/admin/manual-billing/${p.data.invoiceId}`]) : { success: false, error: "取り消す理由を入力してください。" };
}
export async function voidManualInvoice(i: { invoiceId: string; reason: string }): Promise<Result> {
  const p = z.object({ invoiceId: uuid, reason: text(500).min(1) }).safeParse(i);
  return p.success ? call("admin_manual_invoice_void", { p_invoice_id: p.data.invoiceId, p_reason: p.data.reason }, ["/admin/manual-billing", `/admin/manual-billing/${p.data.invoiceId}`]) : { success: false, error: "取り消す理由を入力してください。" };
}
