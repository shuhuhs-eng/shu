import { z } from "zod";
import { BASE_KEYS, SUPPLEMENT_KEYS } from "@/lib/salon-culture/analysis/v1";

/**
 * サロンらしさ追加分析（salon-analysis-v1）の入力検証。
 * 追加5問: 各1〜5の整数、または「当てはまらない」("na")。未回答・null・余分なキーは不可。
 * 「当てはまらない」を数値で埋めることはしない。
 */
const answerValue = z.union([z.number().int().min(1).max(5), z.literal("na")]);
const baseValue = z.number().int().min(1).max(5);

export const supplementAnswersSchema = z
  .object({
    q13_nurture_learning_flow: answerValue,
    q14_nurture_feedback: answerValue,
    q15_brand_staff_presentation: answerValue,
    q16_team_handover: answerValue,
    q17_discretion_proposal: answerValue,
  })
  .strict();

/** フォームを表示した時点で参照していた既存回答5つ（サーバーが保存時に現在値と照合する）。 */
export const expectedBaseSchema = z
  .object({
    q2_challenge_openness: baseValue,
    q3_personal_brand_support: baseValue,
    q4_team_collaboration: baseValue,
    q5_individual_autonomy: baseValue,
    q9_trend_orientation: baseValue,
  })
  .strict();

export const personalAnalysisInputSchema = z.object({
  answers: supplementAnswersSchema,
  expectedBase: expectedBaseSchema,
});

export const storeAnalysisInputSchema = personalAnalysisInputSchema.extend({
  storeId: z.string().uuid(),
});

// スキーマとキー定義のずれを防ぐ（テストでも確認する）。
export const SCHEMA_KEYS = { supplement: [...SUPPLEMENT_KEYS], base: [...BASE_KEYS] };
