"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { BillingIntegrityIssue } from "./integrity";
import type { Database } from "@/types/database";
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

export type OrganizationOverview = Database["public"]["Functions"]["get_admin_organization_overview"]["Returns"][number];

/** 運営者向けの全社サマリー（0041）。失敗時は null（0件と誤表示しない）。 */
export async function getAdminOrganizationOverview(): Promise<OrganizationOverview[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_organization_overview");
  if (error) {
    console.error("[getAdminOrganizationOverview] RPC failed", { message: error.message, code: error.code });
    return null;
  }
  return data ?? [];
}

export type AdminOrganizationStore = Database["public"]["Functions"]["get_admin_organization_stores"]["Returns"][number];

/** 運営者向けの会社の店舗一覧（0042。基本情報と件数だけ）。失敗時は null。 */
export async function getAdminOrganizationStores(organizationId: string): Promise<AdminOrganizationStore[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_organization_stores", { p_organization_id: organizationId });
  if (error) {
    console.error("[getAdminOrganizationStores] RPC failed", { message: error.message, code: error.code });
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
  note: z.string().trim().max(1000).nullable(),
  /** invoice のときだけ。省略（null）なら請求日の翌月末（標準）。YYYY-MM-DD。 */
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

function friendlyError(message: string): string {
  if (message.includes("invalid success fee status transition")) return "この状態からはその操作はできません。画面を更新してください。";
  if (message.includes("reason note is required")) return "理由を入力してください。";
  if (message.includes("fee_amount is required")) return "成功報酬額を入力してください。";
  if (message.includes("invalid due date")) return "支払期限は請求日以降の日付を指定してください。";
  if (message.includes("admin access required")) return "この操作は運営者のみ行えます。";
  return "保存できませんでした。時間をおいて再度お試しください。";
}

/**
 * 運営者による成功報酬の更新。成功報酬額は整数円で送る。
 * 税額・税率・請求書番号・標準の支払期限はすべてDBが決める（税額の手入力はしない）。
 * 通常の請求は due date を送らず標準期限（請求日の翌月末）にする。
 */
export async function adminUpdateSuccessFeeAction(input: z.input<typeof schema>): Promise<BillingActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false, error: "入力内容を確認してください。" };
  const { feeId, action, feeAmount, note, dueDate } = parsed.data;
  if (action === "confirm" && feeAmount === null) {
    return { success: false, error: "成功報酬額を入力してください。" };
  }
  if ((action === "waive" || action === "cancel") && !note) {
    return { success: false, error: "理由を入力してください。" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_success_fee", {
    p_fee_id: feeId,
    p_action: action,
    p_fee_amount: action === "confirm" ? feeAmount : null,
    p_note: note,
    p_due_date: action === "invoice" ? (dueDate ?? null) : null,
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
