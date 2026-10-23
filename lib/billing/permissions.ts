import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * 成功報酬・請求情報を見てよい会社側の役割は company_owner / company_admin のみ。
 * 自分の所属行（RLSで自分の行のみ読める）から判定する。middlewareとページの両方で使う。
 * ★権限の本体はDB側（get_company_success_feesが自社のowner/adminに限定する）。
 */
export async function canViewCompanyBilling(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase.from("organization_members").select("role").eq("user_id", userId);
  return (data ?? []).some((row) => row.role === "company_owner" || row.role === "company_admin");
}
