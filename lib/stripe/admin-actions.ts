"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/security/log";

export type StripeAdminResult = { success: true } | { success: false; error: string };

function adminError(message: string): string {
  if (message.includes("admin access required")) return "この操作は運営者のみ行えます。";
  if (message.includes("resolution note required")) return "対応内容を入力してください。";
  if (message.includes("already resolved")) return "すでに対応済みです。画面を更新してください。";
  if (message.includes("invalid price")) return "税抜価格は1円以上の整数で入力してください。";
  if (message.includes("invalid tax rate")) return "税率は0〜100の範囲で入力してください。";
  if (message.includes("invalid credits")) return "件数は1以上の整数で入力してください。";
  if (message.includes("invalid label")) return "名称を入力してください（100文字まで）。";
  return "保存できませんでした。時間をおいて再度お試しください。";
}

const resolveSchema = z.object({ issueId: z.string().uuid(), note: z.string().trim().min(1).max(1000) });
/** Stripe不整合を「対応済み」にする（状態の自動修復はしない。対応内容の記録のみ）。 */
export async function resolveStripeIssueAction(input: z.input<typeof resolveSchema>): Promise<StripeAdminResult> {
  const p = resolveSchema.safeParse(input);
  if (!p.success) return { success: false, error: "対応内容を入力してください。" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_resolve_stripe_integrity_issue", { p_issue_id: p.data.issueId, p_note: p.data.note });
  if (error) { logError("resolveStripeIssue", error); return { success: false, error: adminError(error.message) }; }
  revalidatePath("/admin/stripe");
  return { success: true };
}

const packageSchema = z.object({
  packageId: z.string().uuid().nullable(),
  label: z.string().trim().min(1).max(100),
  creditsCount: z.number().int().min(1).max(100000),
  priceExclTax: z.number().int().min(1).max(100_000_000),
  taxRate: z.number().min(0).max(100).multipleOf(0.01).nullable(), // null = DB既定(10.00)。税額の計算はDB。
  active: z.boolean(),
});
/** 追加Scout枠の商品（件数と価格）。価格は事業判断のため、運営者が明示的に設定するまで購入できない。 */
export async function upsertScoutCreditPackageAction(input: z.input<typeof packageSchema>): Promise<StripeAdminResult> {
  const p = packageSchema.safeParse(input);
  if (!p.success) return { success: false, error: "入力内容を確認してください（件数・税抜価格は1以上の整数、税率は0〜100）。" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_upsert_scout_credit_package", {
    p_package_id: p.data.packageId, p_label: p.data.label, p_credits_count: p.data.creditsCount,
    p_price_excl_tax: p.data.priceExclTax, p_tax_rate: p.data.taxRate, p_active: p.data.active,
  });
  if (error) { logError("upsertScoutCreditPackage", error); return { success: false, error: adminError(error.message) }; }
  revalidatePath("/admin/stripe");
  return { success: true };
}
