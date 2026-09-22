"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { CAREER_GOALS } from "@/lib/match-profile/options";
import type { Database } from "@/types/database";

const goalCodes = CAREER_GOALS.map((goal) => goal.code) as [string, ...string[]];
const optionalInt = z.number().int().nonnegative().nullable();
const inputSchema = z.object({
  primaryGoal: z.enum(goalCodes),
  secondaryGoals: z.array(z.enum(goalCodes)).max(2),
  careerStage: z.enum(["results_stylist", "growing_stylist", "assistant_newcomer"]),
  wantsPerformanceOffer: z.boolean(),
  evidencePeriodMonths: z.union([z.literal(3), z.literal(6), z.literal(12)]).nullable(),
  avgMonthlyTechnicalSales: optionalInt,
  avgMonthlyRetailSales: optionalInt,
  avgMonthlyClients: optionalInt,
  avgMonthlyNamedClients: optionalInt,
  averageTicket: optionalInt,
  repeatRate: z.number().int().min(0).max(100).nullable(),
  monthlyWorkingDays: z.number().int().min(1).max(31).nullable(),
  averageDailyHours: z.number().min(1).max(24).nullable(),
  selfAcquiredClients: optionalInt,
  expectedTransferClients: optionalInt,
  assistantUsage: z.enum(["none", "shared", "dedicated"]).nullable(),
}).refine((data) => !data.secondaryGoals.includes(data.primaryGoal), {
  message: "最優先とその他の希望が重複しています。",
}).refine((data) => !data.wantsPerformanceOffer || data.careerStage === "results_stylist", {
  message: "実績による給与相談はスタイリスト経験者のみ利用できます。",
}).refine((data) => !data.wantsPerformanceOffer || (
  data.evidencePeriodMonths != null && data.avgMonthlyTechnicalSales != null &&
  data.avgMonthlyClients != null && data.monthlyWorkingDays != null
), {
  message: "実績期間・技術売上・客数・出勤日数を入力してください。",
});

type Input = z.infer<typeof inputSchema>;
type Row = Database["public"]["Tables"]["stylist_match_profiles"]["Row"];
export type SaveMatchProfileResult = { success: true; profile: Row } | { success: false; error: string };

export async function saveStylistMatchProfile(input: Input): Promise<SaveMatchProfileResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "入力内容をご確認ください。" };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_stylist_match_profile_v2", {
    p_primary_goal: v.primaryGoal,
    p_secondary_goals: v.secondaryGoals,
    p_career_stage: v.careerStage,
    p_wants_performance_offer: v.wantsPerformanceOffer,
    p_evidence_period_months: v.evidencePeriodMonths,
    p_avg_monthly_technical_sales: v.avgMonthlyTechnicalSales,
    p_avg_monthly_retail_sales: v.avgMonthlyRetailSales,
    p_avg_monthly_clients: v.avgMonthlyClients,
    p_avg_monthly_named_clients: v.avgMonthlyNamedClients,
    p_average_ticket: v.averageTicket,
    p_repeat_rate: v.repeatRate,
    p_monthly_working_days: v.monthlyWorkingDays,
    p_average_daily_hours: v.averageDailyHours,
    p_self_acquired_clients: v.selfAcquiredClients,
    p_expected_transfer_clients: v.expectedTransferClients,
    p_assistant_usage: v.assistantUsage,
  });
  if (error || !data) {
    console.error("[saveStylistMatchProfile] RPC failed", { message: error?.message, code: error?.code });
    return { success: false, error: "保存に失敗しました。もう一度お試しください。" };
  }
  return { success: true, profile: data };
}
