"use server";

import { createClient } from "@/lib/supabase/server";
import {
  salonCultureStepSchema,
  salonCultureCompletedSchema,
  type SalonCultureStepInput,
} from "@/lib/validation/salon-culture";
import type { Database } from "@/types/database";

type SalonStoreCultureProfileRow = Database["public"]["Tables"]["salon_store_culture_profiles"]["Row"];

export type SaveSalonStoreCultureResult =
  | { success: true; profile: SalonStoreCultureProfileRow }
  | { success: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

/**
 * 店舗単位「サロンらしさ」保存（法人・複数店舗対応 Phase 3B）。
 * lib/salon-culture/actions.ts の saveSalonCultureStep と対称構造。
 *
 * ★既存lib/validation/salon-culture.ts（salonCultureStepSchema/
 * salonCultureCompletedSchema）はそのままimportして再利用する（一切変更
 * していない。p_store_idの検証はstoreId引数そのものがlayout.tsx経由で
 * 既にis_store_accessible()で確認済みのstore_idであるため、ここでは
 * 追加のzod検証を行わない＝既存権限ロジックの複製をしない）。
 *
 * ★既存saveSalonCultureStep()とは異なり、生成AI解説(runSalonCultureAiGenerationJob)
 * は呼び出さない（Phase 3Bではルールベースai_summaryのみ。生成AI解説の
 * 店舗単位対応はPhase 4以降）。
 */
export async function saveSalonStoreCultureStep(
  storeId: string,
  input: SalonCultureStepInput,
): Promise<SaveSalonStoreCultureResult> {
  const schema = input.status === "completed" ? salonCultureCompletedSchema : salonCultureStepSchema;
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    return {
      success: false,
      error: "入力内容をご確認ください。",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>,
    };
  }

  const supabase = await createClient();
  const v = parsed.data;

  const { data, error } = await supabase.rpc("save_salon_store_culture_profile", {
    p_store_id: storeId,
    p_status: v.status,
    p_respondent_role: v.respondentRole,
    p_current_step: v.currentStep,
    p_answers: v.answers,
    p_value_priorities: v.valuePriorities.length > 0 ? v.valuePriorities : null,
    p_comment: v.comment || null,
  });

  if (error || !data) {
    console.error("[saveSalonStoreCultureStep] RPC failed", {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
      storeId,
      status: v.status,
      currentStep: v.currentStep,
    });
    return { success: false, error: "保存に失敗しました。もう一度お試しください。" };
  }

  return { success: true, profile: data };
}
