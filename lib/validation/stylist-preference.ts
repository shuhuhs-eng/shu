import { z } from "zod";

/**
 * 美容師「働きたいサロン環境」Preference入力の検証。全8問、5段階（1〜5）の
 * クリック回答（lib/validation/salon-culture.tsと対称の設計）。途中保存(draft)
 * では各項目が未入力でも送信できるようにし、完了(completed)時のみ必須項目を
 * 厳格に検証する。
 */
const fivePoint = z.number().int().min(1).max(5);

export const stylistPreferenceAnswersSchema = z.object({
  q1_education_preference: fivePoint.optional(),
  q2_challenge_preference: fivePoint.optional(),
  q3_personal_brand_preference: fivePoint.optional(),
  q4_collaboration_preference: fivePoint.optional(),
  q5_autonomy_preference: fivePoint.optional(),
  q6_work_flexibility_preference: fivePoint.optional(),
  q7_relationship_distance_preference: fivePoint.optional(),
  q8_hierarchy_preference: fivePoint.optional(),
});

export const stylistPreferenceStepSchema = z.object({
  status: z.enum(["draft", "completed"]),
  currentStep: z.number().int().min(0).max(7),
  answers: stylistPreferenceAnswersSchema,
});

/** 完了(completed)時のみ適用する、より厳格な検証（8問すべて必須）。 */
export const stylistPreferenceCompletedSchema = stylistPreferenceStepSchema.extend({
  status: z.literal("completed"),
  answers: z.object({
    q1_education_preference: fivePoint,
    q2_challenge_preference: fivePoint,
    q3_personal_brand_preference: fivePoint,
    q4_collaboration_preference: fivePoint,
    q5_autonomy_preference: fivePoint,
    q6_work_flexibility_preference: fivePoint,
    q7_relationship_distance_preference: fivePoint,
    q8_hierarchy_preference: fivePoint,
  }),
});

export type StylistPreferenceStepInput = z.infer<typeof stylistPreferenceStepSchema>;
