import { z } from "zod";

/**
 * 「サロンらしさ」入力の検証。全12問、5段階（1〜5）のクリック回答に統一する
 * （0009で旧5問から再構築。1が悪く5が良いという意味ではなく、両端とも
 * サロンの特徴を表す）。途中保存(draft)では各項目が未入力でも送信できる
 * ようにし、完了(completed)時のみ必須項目を厳格に検証する。
 */
const fivePoint = z.number().int().min(1).max(5);

export const salonCultureAnswersSchema = z.object({
  q1_education_support: fivePoint.optional(),
  q2_challenge_openness: fivePoint.optional(),
  q3_personal_brand_support: fivePoint.optional(),
  q4_team_collaboration: fivePoint.optional(),
  q5_individual_autonomy: fivePoint.optional(),
  q6_work_flexibility: fivePoint.optional(),
  q7_technical_specialization: fivePoint.optional(),
  q8_premium_value: fivePoint.optional(),
  q9_trend_orientation: fivePoint.optional(),
  q10_creative_output: fivePoint.optional(),
  q11_relationship_distance: fivePoint.optional(),
  q12_hierarchy_flatness: fivePoint.optional(),
});

export const salonCultureStepSchema = z.object({
  status: z.enum(["draft", "completed"]),
  respondentRole: z.enum(["owner_representative", "store_manager", "recruiter_hr", "other"]).nullable(),
  currentStep: z.number().int().min(0).max(14),
  answers: salonCultureAnswersSchema,
  valuePriorities: z.array(z.string()).max(3),
  comment: z.string().max(500).optional().or(z.literal("")),
});

/** 完了(completed)時のみ適用する、より厳格な検証（12問すべて必須）。 */
export const salonCultureCompletedSchema = salonCultureStepSchema.extend({
  status: z.literal("completed"),
  respondentRole: z.enum(["owner_representative", "store_manager", "recruiter_hr", "other"]),
  answers: z.object({
    q1_education_support: fivePoint,
    q2_challenge_openness: fivePoint,
    q3_personal_brand_support: fivePoint,
    q4_team_collaboration: fivePoint,
    q5_individual_autonomy: fivePoint,
    q6_work_flexibility: fivePoint,
    q7_technical_specialization: fivePoint,
    q8_premium_value: fivePoint,
    q9_trend_orientation: fivePoint,
    q10_creative_output: fivePoint,
    q11_relationship_distance: fivePoint,
    q12_hierarchy_flatness: fivePoint,
  }),
  valuePriorities: z.array(z.string()).length(3, "重要な項目を3つ選択してください"),
});

export type SalonCultureStepInput = z.infer<typeof salonCultureStepSchema>;
