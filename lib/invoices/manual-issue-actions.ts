"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { manualBillingEnabled } from "@/lib/billing/hire-flags";
import { renderInvoicePdf } from "./pdf";
import { ensureInvoiceBucket, invoicePdfAgeMs, removeInvoicePdf, sha256Hex, uploadInvoicePdf } from "./storage";
import { issueManualInvoicePdf } from "./manual-issue-flow";
import type { InvoiceActionResult } from "./types";

/** 手動請求の請求書PDFを発行する（責任者のみ・MANUAL_BILLING_ENABLED=1のときだけ）。既存の描画・保存・取得を再利用。 */
export async function issueManualInvoicePdfAction(invoiceId: string): Promise<InvoiceActionResult> {
  if (!manualBillingEnabled()) return { success: false, error: "この機能はまだ有効になっていません。" };
  if (!z.string().uuid().safeParse(invoiceId).success) return { success: false, error: "入力内容を確認してください。" };
  const supabase = (await createClient()) as unknown as Pick<SupabaseClient, "rpc">;
  const result = await issueManualInvoicePdf({
    rpc: (fn, args) => supabase.rpc(fn, args) as never,
    render: renderInvoicePdf, sha256: sha256Hex, ensureBucket: ensureInvoiceBucket, upload: uploadInvoicePdf, ageMs: invoicePdfAgeMs, remove: removeInvoicePdf,
  }, invoiceId);
  revalidatePath(`/admin/manual-billing/${invoiceId}`); revalidatePath("/admin/manual-billing");
  return result;
}
