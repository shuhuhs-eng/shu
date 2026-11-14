import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 運営者かどうか。判定の本体はDBの is_platform_admin()（platform_admins 表）。
 * メールアドレスの文字列では判定しない。RPCが失敗した場合は「運営者ではない」として扱う（安全側）。
 */
export async function isPlatformAdmin(supabase: Pick<SupabaseClient, "rpc">): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("is_platform_admin");
    return !error && data === true;
  } catch {
    return false;
  }
}
