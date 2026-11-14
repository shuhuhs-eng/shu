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

/**
 * 運営者かどうかを3値で返す。行き先を決める処理（マイページ・ホーム）用。
 *   "admin"     … is_platform_admin() が true
 *   "not_admin" … 問い合わせ成功で、運営者ではない
 *   "error"     … 確認できなかった（RPCエラー・例外・想定外の値）
 * ★「確認できなかった」を「運営者ではない＝美容師・サロン」として扱わないために分ける
 *   （運営者を誤って美容師のマイページ・登録画面へ送らない。画面は再試行できるエラーにする）。
 * アクセス制御の入口（isPlatformAdmin）は従来どおり「確認できなければ入れない」安全側のまま。
 */
export type AdminStatus = "admin" | "not_admin" | "error";
export async function getAdminStatus(supabase: Pick<SupabaseClient, "rpc">): Promise<AdminStatus> {
  try {
    const { data, error } = await supabase.rpc("is_platform_admin");
    if (error) return "error";
    if (data === true) return "admin";
    if (data === false) return "not_admin";
    return "error";
  } catch {
    return "error";
  }
}
