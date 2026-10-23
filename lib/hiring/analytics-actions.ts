"use server";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type CompanyHiringAnalytics = Database["public"]["Functions"]["get_company_hiring_analytics"]["Returns"];

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
