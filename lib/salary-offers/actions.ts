"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { RECRUITING_PAUSED_MESSAGE, isRecruitingPausedError } from "@/lib/contracts/recruiting-access";

const offerFields = {
  stylistUserId: z.string().uuid(),
  monthlyGuarantee: z.number().int().min(100000).max(2000000),
  performanceAddition: z.number().int().min(0).max(1000000),
  performanceCondition: z.string().trim().max(500).nullable(),
  guaranteeMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  message: z.string().trim().max(500).nullable(),
};

// 実績加算まわりの共通ルール（旧・店舗単位の両方で同一）。
const additionIsThousands = (v: { performanceAddition: number }): boolean =>
  v.performanceAddition % 1000 === 0;
const conditionPresentWhenAddition = (v: {
  performanceAddition: number;
  performanceCondition: string | null;
}): boolean =>
  v.performanceAddition === 0 || (v.performanceCondition != null && v.performanceCondition.length > 0);

const offerSchema = z.object(offerFields).refine(
  additionIsThousands,
  { message: "実績加算は1,000円単位で入力してください。", path: ["performanceAddition"] },
).refine(
  conditionPresentWhenAddition,
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
    if (isRecruitingPausedError(error.message)) return { success: false, error: RECRUITING_PAUSED_MESSAGE };
    return { success: false, error: "条件を提示できませんでした。既に回答待ちの提示がないか確認してください。" };
  }
  revalidatePath("/salon/mypage");
  revalidatePath("/stylist/mypage");
  return { success: true };
}

const storeOfferSchema = z.object({ storeId: z.string().uuid(), ...offerFields }).refine(
  additionIsThousands,
  { message: "実績加算は1,000円単位で入力してください。", path: ["performanceAddition"] },
).refine(
  conditionPresentWhenAddition,
  { message: "実績加算を設定する場合は、支給条件を入力してください。", path: ["performanceCondition"] },
);

/**
 * 店舗単位の給与オファー作成（Phase 6）。create_salary_offer_v2のみを呼ぶ薄い
 * ラッパー。storeIdは呼び出し元（店舗workspaceのparams.storeId）が明示的に
 * 渡す値で、auth.uid()・salon_user_id・organizationから推測しない。
 * 検証ルール（1,000円単位・実績加算>0なら支給条件必須）は旧createSalaryOfferと同一。
 * Interest済み・実績確認済みの判定はRPC側（DB）を正とする。
 */
export async function createStoreSalaryOffer(input: z.infer<typeof storeOfferSchema>): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = storeOfferSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "提示条件を確認してください。" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_salary_offer_v2", {
    p_store_id: parsed.data.storeId,
    p_stylist_user_id: parsed.data.stylistUserId,
    p_monthly_guarantee: parsed.data.monthlyGuarantee,
    p_performance_addition: parsed.data.performanceAddition,
    p_guarantee_months: parsed.data.guaranteeMonths,
    p_performance_condition: parsed.data.performanceCondition,
    p_salon_message: parsed.data.message,
  });
  if (error) {
    console.error("[createStoreSalaryOffer] RPC failed", { message: error.message, code: error.code });
    if (isRecruitingPausedError(error.message)) return { success: false, error: RECRUITING_PAUSED_MESSAGE };
    if (error.message.includes("interest required")) {
      return { success: false, error: "この美容師から「話を聞いてみたい」が届いていないため、条件を提示できません。" };
    }
    if (error.message.includes("verified opt-in profile required")) {
      return { success: false, error: "実績の確認が完了している美容師にのみ条件を提示できます。" };
    }
    return { success: false, error: "条件を提示できませんでした。既に回答待ちの提示がないか確認してください。" };
  }
  revalidatePath(`/salon/stores/${parsed.data.storeId}/interests`);
  revalidatePath(`/salon/stores/${parsed.data.storeId}/offers`);
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
  revalidatePath("/stylist/mypage"); revalidatePath("/stylist/offers"); revalidatePath("/salon/mypage");
  return { success: true };
}

