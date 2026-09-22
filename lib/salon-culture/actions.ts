"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  salonCultureStepSchema,
  salonCultureCompletedSchema,
  type SalonCultureStepInput,
} from "@/lib/validation/salon-culture";
import { runSalonCultureAiGenerationJob } from "@/lib/salon-culture/run-culture-ai-job";
import type { Database } from "@/types/database";

type SalonCultureProfileRow = Database["public"]["Tables"]["salon_culture_profiles"]["Row"];

export type SaveSalonCultureResult =
  | { success: true; profile: SalonCultureProfileRow }
  | { success: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

/**
 * 「サロンらしさ」の回答を保存する。draft（途中保存）はゆるい検証、
 * completed（完了）は厳格な検証を行った上で、save_salon_culture_profile() RPCを
 * 呼ぶだけの薄いラッパー。CultureAxisの数値化・AI要約の生成はRPC（SQL側）が
 * 独自に行うため、ここでは計算を一切行わない。
 *
 * 通常のForm ServerActionとは異なり、ウィザードの各ステップ遷移時に
 * 直接関数として呼び出す（<form action>には束縛しない）。これにより、
 * 途中離脱してもそれまでの回答がDBに保存された状態になる。
 */
export async function saveSalonCultureStep(input: SalonCultureStepInput): Promise<SaveSalonCultureResult> {
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

  const { data, error } = await supabase.rpc("save_salon_culture_profile", {
    p_status: v.status,
    p_respondent_role: v.respondentRole,
    p_current_step: v.currentStep,
    p_answers: v.answers,
    p_value_priorities: v.valuePriorities.length > 0 ? v.valuePriorities : null,
    p_comment: v.comment || null,
  });

  if (error || !data) {
    // ★診断用ログ: PostgrestErrorの各フィールドを明示的に出力する
    // （console.error(error)だけだとNode側でオブジェクトの詳細が
    // 省略され、code/details/hintが見えないことがあるため）。
    console.error("[saveSalonCultureStep] RPC failed", {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
      status: v.status,
      currentStep: v.currentStep,
    });
    return { success: false, error: "保存に失敗しました。もう一度お試しください。" };
  }

  // ★サロン専用AI解説の生成。status="completed"で保存が成功した直後にのみ
  // トリガーする（マイページアクセスのたびに生成しない。途中保存(draft)では
  // 生成しない）。DB保存（save_salon_culture_profileの成否）には一切影響を
  // 与えない（after内で失敗しても、この関数はすでにsuccess:trueを
  // 返した後）。
  //
  // ★0012_salon_culture_ai_outputs.sqlにより、旧14問診断（diagnosis_results）
  // への依存を完全に削除した。save_salon_culture_profile()の戻り値data
  // （＝salon_culture_profilesの行、data.idがsalon_culture_profiles.id）を
  // そのまま新AI生成ジョブへ渡すだけで、diagnosis_resultsを検索する処理は
  // 一切行わない。旧14問診断を受診済みかどうかに関わらず、常に同じ経路で
  // AI解説が生成される。
  if (v.status === "completed") {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token ?? null;

    if (accessToken) {
      after(() => runSalonCultureAiGenerationJob(data, accessToken));
    } else {
      console.error("[saveSalonCultureStep] no access token available, skipping salon AI generation");
    }
  }

  return { success: true, profile: data };
}
