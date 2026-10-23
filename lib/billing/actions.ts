"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { BillingIntegrityIssue } from "./integrity";
import type { AdminSuccessFee, BillingActionResult, CompanySuccessFee } from "./types";

/** 運営者向け一覧。権限が無い／失敗した場合は null（RPCが運営者以外を拒否する）。 */
export async function getAdminSuccessFees(): Promise<AdminSuccessFee[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_success_fees", { p_status: null });
  if (error) {
    console.error("[getAdminSuccessFees] RPC failed", { message: error.message, code: error.code });
    return null;
  }
  return data ?? [];
}

/** 運営者向けの整合性チェック（読み取り専用）。失敗時は null（0件と誤表示しない）。 */
export async function getBillingIntegrityIssues(): Promise<BillingIntegrityIssue[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_billing_integrity_issues");
  if (error) {
    console.error("[getBillingIntegrityIssues] RPC failed", { message: error.message, code: error.code });
    return null;
  }
  return data ?? [];
}

/** 会社側の閲覧。自社のcompany_owner/company_adminでなければ空または失敗(null)。 */
export async function getCompanySuccessFees(): Promise<CompanySuccessFee[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_company_success_fees", { p_organization_id: null });
  if (error) {
    console.error("[getCompanySuccessFees] RPC failed", { message: error.message, code: error.code });
    return null;
  }
  return data ?? [];
}

const schema = z.object({
  feeId: z.string().uuid(),
  action: z.enum(["confirm", "invoice", "paid", "waive", "cancel"]),
  feeAmount: z.number().int().min(0).max(999_999_999).nullable(),
  taxAmount: z.number().int().min(0).max(999_999_999).nullable(),
  note: z.string().trim().max(1000).nullable(),
});

function friendlyError(message: string): string {
  if (message.includes("invalid success fee status transition")) return "この状態からはその操作はできません。画面を更新してください。";
  if (message.includes("reason note is required")) return "理由を入力してください。";
  if (message.includes("fee_amount and tax_amount are required")) return "成功報酬額と税額を入力してください。";
  if (message.includes("admin access required")) return "この操作は運営者のみ行えます。";
  return "保存できませんでした。時間をおいて再度お試しください。";
}

/** 運営者による成功報酬の更新。金額・税額は整数円で明示的に送る（税率はアプリにもDBにも持たない）。 */
export async function adminUpdateSuccessFeeAction(input: z.input<typeof schema>): Promise<BillingActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false, error: "入力内容を確認してください。" };
  const { feeId, action, feeAmount, taxAmount, note } = parsed.data;
  if (action === "confirm" && (feeAmount === null || taxAmount === null)) {
    return { success: false, error: "成功報酬額と税額を入力してください。" };
  }
  if ((action === "waive" || action === "cancel") && !note) {
    return { success: false, error: "理由を入力してください。" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_success_fee", {
    p_fee_id: feeId,
    p_action: action,
    p_fee_amount: action === "confirm" ? feeAmount : null,
    p_tax_amount: action === "confirm" ? taxAmount : null,
    p_note: note,
  });
  if (error) {
    console.error("[adminUpdateSuccessFee] RPC failed", { message: error.message, code: error.code });
    return { success: false, error: friendlyError(error.message) };
  }
  revalidatePath("/admin/success-fees");
  revalidatePath("/admin");
  revalidatePath("/salon/company/billing");
  revalidatePath("/salon/company");
  return { success: true };
}
