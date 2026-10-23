"use server";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type CompanyHiringAnalytics = Database["public"]["Functions"]["get_company_hiring_analytics"]["Returns"];
type Fns = Database["public"]["Functions"];

/**
 * 会社の採用分析を1回のRPCで取得する（店舗ごとのループはしない）。
 * 権限が無い／失敗した場合は null（0件と誤表示しない）。
 */
export async function getCompanyHiringAnalytics(): Promise<CompanyHiringAnalytics | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_company_hiring_analytics", { p_organization_id: null });
  if (error) {
    console.error("[getCompanyHiringAnalytics] RPC failed", { message: error.message, code: error.code });
    return null;
  }
  return data ?? null;
}

/** 活動ベース：期間内に初めて各段階へ到達した人数（0042）。失敗時は null。 */
export async function getHiringActivity(from: string, to: string): Promise<Fns["get_company_hiring_period_analytics"]["Returns"] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_company_hiring_period_analytics", {
    p_from: from,
    p_to: to,
    p_organization_id: null,
  });
  if (error) {
    console.error("[getHiringActivity] RPC failed", { message: error.message, code: error.code });
    return null;
  }
  return data ?? null;
}

/** 候補者獲得コホート：期間内に候補者になった人の現在までの到達結果（0042）。失敗時は null。 */
export async function getHiringCohort(from: string, to: string): Promise<Fns["get_company_hiring_cohort_analytics"]["Returns"] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_company_hiring_cohort_analytics", {
    p_from: from,
    p_to: to,
    p_organization_id: null,
  });
  if (error) {
    console.error("[getHiringCohort] RPC failed", { message: error.message, code: error.code });
    return null;
  }
  return data ?? null;
}
