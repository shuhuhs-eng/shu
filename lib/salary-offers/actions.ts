"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const offerSchema = z.object({
  stylistUserId: z.string().uuid(),
  monthlyGuarantee: z.number().int().min(100000).max(2000000),
  performanceAddition: z.number().int().min(0).max(1000000),
  performanceCondition: z.string().trim().max(500).nullable(),
  guaranteeMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  message: z.string().trim().max(500).nullable(),
}).refine(
  (v) => v.performanceAddition === 0 || (v.performanceCondition != null && v.performanceCondition.length > 0),
  { message: "実績加算を設定する場合は、支給条件を入力してください。", path: ["performanceCondition"] },
);

export async function createSalaryOffer(input: z.infer<typeof offerSchema>): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = offerSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "提示条件を確認してください。" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_salary_offer", {
    p_stylist_user_id: parsed.data.stylistUserId,
    p_monthly_guarantee: parsed.data.monthlyGuarantee,
    p_performance_addition: parsed.data.performanceAddition,
    p_guarantee_months: parsed.data.guaranteeMonths,
    p_performance_condition: parsed.data.performanceCondition,
    p_salon_message: parsed.data.message,
  });
  if (error) {
    console.error("[createSalaryOffer] RPC failed", { message: error.message, code: error.code });
    return { success: false, error: "条件を提示できませんでした。既に回答待ちの提示がないか確認してください。" };
  }
  revalidatePath("/salon/mypage");
  revalidatePath("/stylist/mypage");
  return { success: true };
}

const responseSchema = z.object({
  offerId: z.string().uuid(), response: z.enum(["accepted", "revision_requested", "declined"]),
  reason: z.enum(["workdays", "guarantee_period", "role", "performance_basis", "other"]).nullable(),
  note: z.string().trim().max(500).nullable(),
}).refine((v) => v.response !== "revision_requested" || v.reason != null, { message: "相談したい項目を選んでください。" });

export async function respondSalaryOffer(input: z.infer<typeof responseSchema>): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = responseSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "回答を確認してください。" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_salary_offer", {
    p_offer_id: parsed.data.offerId, p_response: parsed.data.response,
    p_reason: parsed.data.reason, p_note: parsed.data.note,
  });
  if (error) return { success: false, error: "回答を保存できませんでした。" };
  revalidatePath("/stylist/mypage"); revalidatePath("/salon/mypage");
  return { success: true };
}

