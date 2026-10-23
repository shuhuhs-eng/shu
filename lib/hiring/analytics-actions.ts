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

export type FiscalYearStart =
  | { status: "ok"; month: number }
  /** 所属する会社の年度開始月が一致しない（会社をまたいで一つの年度では集計できない）。 */
  | { status: "mixed" }
  /** 取得に失敗した。「4月」と黙って代用しない。 */
  | { status: "error" };

/**
 * 自分が会社レベルの役割を持つ会社の年度開始月を読む（0043）。
 * ★salon_organizations の既存の読み取りポリシー（会社のメンバーなら読める）を使うので、
 * recruiting_admin / area_manager でも年度開始月だけは読める。契約金額のRPCは使わない。
 */
export async function getFiscalYearStart(): Promise<FiscalYearStart> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "error" };

  const { data: members, error: memberError } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id);
  if (memberError || !members || members.length === 0) {
    if (memberError) console.error("[getFiscalYearStart] members read failed", { message: memberError.message, code: memberError.code });
    return { status: "error" };
  }

  const { data: orgs, error: orgError } = await supabase
    .from("salon_organizations")
    .select("id, fiscal_year_start_month")
    .in("id", members.map((m) => m.organization_id));
  if (orgError || !orgs || orgs.length === 0) {
    if (orgError) console.error("[getFiscalYearStart] organizations read failed", { message: orgError.message, code: orgError.code });
    return { status: "error" };
  }

  const months = new Set(orgs.map((o) => o.fiscal_year_start_month));
  if (months.size > 1) return { status: "mixed" };
  const [month] = [...months];
  if (month === undefined || month < 1 || month > 12) return { status: "error" };
  return { status: "ok", month };
}
