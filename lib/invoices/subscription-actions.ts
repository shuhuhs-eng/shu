"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { missingLabels } from "./messages";
import { issueSubscriptionInvoiceAsAdmin, type SubscriptionIssueResult } from "./subscription-issue";
import type { InvoiceActionResult } from "./types";

/**
 * 月額の適格請求書PDFの手動発行・再試行（運営者のみ。権限確認は各RPCがDBで行う）。
 * 支払記録は既に確定している前提で、PDFだけをやり直す。
 */
const GENERIC = "請求書PDFを発行できませんでした。時間をおいて再度お試しください。";

function toResult(r: SubscriptionIssueResult): InvoiceActionResult {
  switch (r.status) {
    case "issued": return { success: true, message: "請求書PDFを発行しました。" };
    case "already_issued": return { success: true, message: "この請求書はすでに発行済みです。" };
    case "not_ready": return { success: false, error: "請求書を発行するために、次の項目を確認してください。", missing: missingLabels(r.missing) };
    case "failed": return { success: false, error: GENERIC };
  }
}

export async function retrySubscriptionInvoiceAction(paymentId: string): Promise<InvoiceActionResult> {
  if (!z.string().uuid().safeParse(paymentId).success) return { success: false, error: "入力内容を確認してください。" };
  const supabase = await createClient();
  const r = await issueSubscriptionInvoiceAsAdmin(supabase, paymentId);
  if (r.status === "failed") {
    console.error("[retrySubscriptionInvoice] failed", { reason: r.reason });
    if (r.reason.includes("admin access required")) return { success: false, error: "この操作は運営者のみ行えます。" };
  }
  revalidatePath("/admin/stripe");
  revalidatePath("/salon/company/billing");
  return toResult(r);
}

/** 未発行の支払をまとめて再試行する（発行条件が揃っているものだけが発行される。最大20件）。 */
export async function retryAllUnissuedSubscriptionInvoicesAction(): Promise<InvoiceActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_unissued_subscription_invoices");
  if (error) {
    return { success: false, error: error.message.includes("admin access required") ? "この操作は運営者のみ行えます。" : GENERIC };
  }
  let issued = 0, blocked = 0, failed = 0;
  for (const row of (data ?? []).slice(0, 20)) {
    const r = await issueSubscriptionInvoiceAsAdmin(supabase, row.payment_id);
    if (r.status === "issued") issued++;
    else if (r.status === "not_ready") blocked++;
    else if (r.status === "failed") failed++;
  }
  revalidatePath("/admin/stripe");
  revalidatePath("/salon/company/billing");
  if (issued === 0 && blocked === 0 && failed === 0) return { success: true, message: "未発行の請求書はありません。" };
  return { success: failed === 0, ...(failed === 0
    ? { message: `発行 ${issued}件／条件不足 ${blocked}件` }
    : { error: `発行 ${issued}件／条件不足 ${blocked}件／失敗 ${failed}件。失敗分は時間をおいて再試行してください。` }) } as InvoiceActionResult;
}
