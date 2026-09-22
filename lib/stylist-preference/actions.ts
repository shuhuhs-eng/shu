"use server";

import { createClient } from "@/lib/supabase/server";
import {
  stylistPreferenceStepSchema,
  stylistPreferenceCompletedSchema,
  type StylistPreferenceStepInput,
} from "@/lib/validation/stylist-preference";
import type { Database } from "@/types/database";

type StylistPreferenceProfileRow = Database["public"]["Tables"]["stylist_preference_profiles"]["Row"];

export type SaveStylistPreferenceResult =
  | { success: true; profile: StylistPreferenceProfileRow }
  | { success: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

/**
 * 「働きたいサロン環境」Preferenceの回答を保存する。draft（途中保存）は
 * ゆるい検証、completed（完了）は厳格な検証を行った上で、
 * save_stylist_preference_profile() RPCを呼ぶだけの薄いラッパー
 * （lib/salon-culture/actions.tsのsaveSalonCultureStep()と対称構造）。
 * 0/25/50/75/100への変換はRPC（SQL側）が独自に行うため、ここでは計算を
 * 一切行わない。
 *
 * ウィザードの各ステップ遷移時に直接関数として呼び出す（<form action>には
 * 束縛しない）。これにより、途中離脱してもそれまでの回答がDBに保存された
 * 状態になる。
 */
export async function saveStylistPreferenceStep(
  input: StylistPreferenceStepInput,
): Promise<SaveStylistPreferenceResult> {
  const schema = input.status === "completed" ? stylistPreferenceCompletedSchema : stylistPreferenceStepSchema;
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

  const { data, error } = await supabase.rpc("save_stylist_preference_profile", {
    p_status: v.status,
    p_current_step: v.currentStep,
    p_answers: v.answers,
  });

  if (error || !data) {
    console.error("[saveStylistPreferenceStep] RPC failed", {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
      status: v.status,
      currentStep: v.currentStep,
    });
    return { success: false, error: "保存に失敗しました。もう一度お試しください。" };
  }

  return { success: true, profile: data };
}
