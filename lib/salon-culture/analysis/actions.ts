"use server";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/security/log";
import { ANALYSIS_VERSION } from "@/lib/salon-culture/analysis/v1";
import { mapAnalysisSaveError, type AnalysisSaveErrorCode } from "@/lib/salon-culture/analysis/errors";
import { personalAnalysisInputSchema, storeAnalysisInputSchema } from "@/lib/validation/salon-culture-analysis";

export type SaveAnalysisResult =
  | { success: true }
  | { success: false; code: AnalysisSaveErrorCode; error: string };

const INVALID: SaveAnalysisResult = { success: false, code: "invalid", error: "入力内容をご確認ください。" };

/**
 * 追加5問の回答を保存する（本人のサロンらしさに対する追加回答）。
 * 保存・権限・既存回答の照合はすべてRPC（SQL側）が行う。ここは検証して渡すだけで、
 * 回答の補完・補正・AI再生成はしない。expectedBase は「フォームを表示した時点の既存回答」。
 */
export async function saveSalonCultureAnalysis(input: unknown): Promise<SaveAnalysisResult> {
  const parsed = personalAnalysisInputSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_salon_culture_analysis_answers", {
    p_version: ANALYSIS_VERSION,
    p_answers: parsed.data.answers,
    p_expected_base: parsed.data.expectedBase,
  });
  if (error) {
    logError("saveSalonCultureAnalysis", error);
    return mapAnalysisSaveError(error.message);
  }
  return { success: true };
}

/** 店舗のサロンらしさに対する追加回答。個人のものとは別の行に保存され、自動では同期しない。 */
export async function saveSalonStoreCultureAnalysis(input: unknown): Promise<SaveAnalysisResult> {
  const parsed = storeAnalysisInputSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_salon_store_culture_analysis_answers", {
    p_store_id: parsed.data.storeId,
    p_version: ANALYSIS_VERSION,
    p_answers: parsed.data.answers,
    p_expected_base: parsed.data.expectedBase,
  });
  if (error) {
    logError("saveSalonStoreCultureAnalysis", error);
    return mapAnalysisSaveError(error.message);
  }
  return { success: true };
}
