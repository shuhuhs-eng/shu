import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminStatus } from "@/lib/admin/is-admin";
import { ADMIN_HOME_PATH } from "@/lib/auth/post-auth-redirect";

/**
 * サイト共通の「マイページ」の行き先を決める唯一の場所（/mypage とホームが使う）。
 *   運営者（is_platform_admin()）        → /admin
 *   美容師roleを完了済み                  → /stylist/mypage
 *   サロンroleのみ完了済み                → /salon/mypage
 *   どちらも未完了                        → /onboarding
 *   運営者かどうか・roleを確認できなかった → error（再試行できるエラー。美容師やオンボーディングへは送らない）
 * ★運営者の判定はDBの is_platform_admin() のみ。メールアドレスの文字列・profiles.role では判定しない。
 * ★運営者が（過去の登録などで）美容師・サロンのroleの行を持っていても、運営者を優先して /admin へ送る。
 *   roleの行は書き換えない。
 */
export type MypageTarget = { ok: true; path: string } | { ok: false; reason: "admin_check_failed" | "role_check_failed" };

type Supa = Pick<SupabaseClient, "rpc" | "from">;

export async function resolveMypagePath(supabase: Supa, userId: string): Promise<MypageTarget> {
  const admin = await getAdminStatus(supabase);
  if (admin === "admin") return { ok: true, path: ADMIN_HOME_PATH };
  if (admin === "error") return { ok: false, reason: "admin_check_failed" };
  try {
    const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (error) return { ok: false, reason: "role_check_failed" };
    const roles = new Set((data ?? []).map((r: { role: string }) => r.role));
    if (roles.has("stylist")) return { ok: true, path: "/stylist/mypage" };
    if (roles.has("salon")) return { ok: true, path: "/salon/mypage" };
    return { ok: true, path: "/onboarding" };
  } catch {
    return { ok: false, reason: "role_check_failed" };
  }
}
