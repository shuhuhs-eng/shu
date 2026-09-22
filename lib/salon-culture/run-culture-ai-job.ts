import { createTokenClient } from "@/lib/supabase/token-client";
import { generateSalonCultureNarrative } from "@/lib/ai/generate-salon-culture-narrative";
import { deriveSalonTypes, SALON_TYPE_CONTENT } from "@/lib/salon-culture/salon-culture-types";
import type { Database, SalonCultureAxes } from "@/types/database";

type SalonCultureProfileRow = Database["public"]["Tables"]["salon_culture_profiles"]["Row"];

/**
 * サロン専用AI解説の生成ジョブ。
 *
 * ★lib/diagnosis-handoff/claim.ts の runAiGenerationJob()（美容師本人向け）
 * とは完全に独立した実装。呼び出すAI生成関数（generateSalonCultureNarrative）・
 * 入力データ（salon_culture_profilesの12軸・value_priorities・comment・
 * サロン8タイプ）が異なるだけでなく、保存先も完全に独立している。
 *
 * ★0012_salon_culture_ai_outputs.sqlで新設した専用テーブル・専用RPC
 * （create_salon_culture_ai_output / activate_salon_culture_ai_output）
 * のみを使う。diagnosis_ai_outputs・diagnosis_results・
 * set_diagnosis_ai_status()・create_ai_output()・activate_ai_output()への
 * 依存は完全に削除した（旧14問診断の存在確認も行わない。
 * salon_culture_profiles.id が確定していれば、14問診断の受診有無に
 * 関わらず常に同じ経路でAIを保存できる）。
 *
 * ★salon_culture_profilesにはdiagnosis_results.ai_statusに相当する列が
 * 存在しないため、生成中/完了/失敗のステータス管理（旧
 * set_diagnosis_ai_status相当の処理）は行わない。呼び出し元
 * （app/salon/mypage/page.tsx）は「salon_culture_ai_outputsが存在するか」
 * のみで表示を判定する。
 *
 * ★generateSalonCultureNarrative()が失敗（null）を返しても、この関数は
 * 例外を投げない。salon_culture_profiles本体の保存（呼び出し元の
 * save_salon_culture_profile RPC）を一切ブロックしない設計
 * （美容師側と同じ「AI解説はあれば良い付加情報」という方針）。
 */
export async function runSalonCultureAiGenerationJob(
  cultureProfile: SalonCultureProfileRow,
  accessToken: string,
): Promise<void> {
  console.log("[SALON-AI-JOB] runSalonCultureAiGenerationJob started", {
    salonCultureProfileId: cultureProfile.id,
  });

  const supabase = createTokenClient(accessToken);

  const axes: SalonCultureAxes = cultureProfile.culture_axes ?? {};
  const classification = deriveSalonTypes(axes);

  const result = await generateSalonCultureNarrative({
    cultureAxes: axes,
    valuePriorities: cultureProfile.value_priorities,
    comment: cultureProfile.comment,
    mainTypeName: classification ? SALON_TYPE_CONTENT[classification.mainType].name : null,
    subTypeName: classification ? SALON_TYPE_CONTENT[classification.subType].name : null,
  });
  console.log("[SALON-AI-JOB] generateSalonCultureNarrative returned", { success: result !== null });

  if (!result) {
    console.log("[SALON-AI-JOB] narrative generation returned null, skipping save");
    return;
  }

  const { narrative, model, promptVersion } = result;
  const entries: Array<{
    type: "essence" | "explanation" | "advice" | "growth";
    response: string | string[];
  }> = [
    { type: "essence", response: narrative.essence },
    { type: "explanation", response: narrative.explanation },
    { type: "advice", response: narrative.advice },
    { type: "growth", response: narrative.growth },
  ];

  for (const entry of entries) {
    const { data: created, error: createError } = await supabase.rpc("create_salon_culture_ai_output", {
      p_salon_culture_profile_id: cultureProfile.id,
      p_output_type: entry.type,
      p_provider: "anthropic",
      p_model: model,
      p_prompt_version: promptVersion,
      p_response: entry.response,
    });

    if (createError || !created) {
      console.error("[SALON-AI-JOB] create_salon_culture_ai_output failed", entry.type, createError);
      continue;
    }

    const { error: activateError } = await supabase.rpc("activate_salon_culture_ai_output", {
      p_ai_output_id: created.id,
    });
    if (activateError) {
      console.error("[SALON-AI-JOB] activate_salon_culture_ai_output failed", entry.type, activateError);
    }
  }

  console.log("[SALON-AI-JOB] done", { salonCultureProfileId: cultureProfile.id });
}
