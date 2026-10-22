import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * 採用進捗への「書き込みボタンを出すか」の判定（表示上のヒント）。
 *
 * ★権限の本体はDB側（can_manage_store_hiring。書き込みRPCが必ず検証する）。
 * ここはそれと同じ規則を自分の所属行（RLSで自分の行のみ読める
 * organization_members / store_members）から再現し、viewer等に書き込み
 * ボタンを出さないためだけに使う。食い違ってもDBが拒否する。
 *   A. 会社の company_owner / company_admin / recruiting_admin
 *   B. area_manager かつ対象店舗の store_members 割当がある
 *   C. 対象店舗の store_members.role が store_manager / recruiter
 * viewerだけ → false。
 */
export async function canManageStoreHiringHint(
  supabase: SupabaseClient<Database>,
  userId: string,
  storeId: string,
  organizationId: string,
): Promise<boolean> {
  const [orgResult, storeResult] = await Promise.all([
    supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("store_members").select("role").eq("store_id", storeId).eq("user_id", userId).maybeSingle(),
  ]);

  const orgRole = orgResult.data?.role ?? null;
  const storeRole = storeResult.data?.role ?? null;

  if (orgRole === "company_owner" || orgRole === "company_admin" || orgRole === "recruiting_admin") return true;
  if (orgRole === "area_manager" && storeResult.data) return true;
  return storeRole === "store_manager" || storeRole === "recruiter";
}

/**
 * 会社横断の画面（/salon/company/hiring 等）に入れる会社レベルの役割。
 * company_owner / company_admin / recruiting_admin は会社の全店舗、
 * area_manager は担当店舗のみ。store_manager / recruiter / viewer（店舗レベルの
 * 役割だけの担当者）は会社横断の画面には入れない。
 * 自分の所属行（RLSで自分の行のみ読める）から判定する。middlewareとページの両方で使う。
 */
export async function hasCompanyLevelRole(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase.from("organization_members").select("role").eq("user_id", userId).limit(1);
  return (data ?? []).some(
    (row) =>
      row.role === "company_owner" ||
      row.role === "company_admin" ||
      row.role === "recruiting_admin" ||
      row.role === "area_manager",
  );
}
