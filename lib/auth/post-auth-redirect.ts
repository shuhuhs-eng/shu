import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isOnboardingComplete } from "@/lib/auth/onboarding";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { getAdminStatus, isPlatformAdmin } from "@/lib/admin/is-admin";

/** 運営者のログイン後の行き先。サロン名・店舗登録（オンボーディング）へは進ませない。 */
export const ADMIN_HOME_PATH = "/admin";

/**
 * ログイン直後・メール確認直後の行き先を決定する唯一の場所。
 * role判定・onboarding判定・遷移先決定をここに集約し、
 * lib/auth/actions.ts の signInAction（Server Action）と
 * app/auth/callback/route.ts（Route Handler）の両方から呼ぶ。
 *
 * 実際のリダイレクト実行（next/navigationのredirect() あるいは
 * NextResponse.redirect()）は呼び出し元の責務とする
 * （Server Action と Route Handler で実行コンテキストが異なるため、
 * ここではパス文字列を返すだけに留める）。
 *
 * 判定ロジックが1箇所にまとまっているため、将来ロール（例: admin）や
 * オンボーディングの分岐条件が増えても、ここだけ直せば両方の呼び出し元に反映される。
 */
export async function determinePostAuthPath(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  if (await isPlatformAdmin(supabase)) return ADMIN_HOME_PATH;
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (!profile) {
    return "/";
  }

  if (!isOnboardingComplete(profile.onboarding_step)) {
    return profile.role === "salon" ? "/onboarding/salon" : "/onboarding";
  }

  return "/";
}

/**
 * 役割別ログイン入口（/stylist/login・/salon/login）専用の遷移先決定。
 * determinePostAuthPath とは別に用意する（あちらは"/"へ戻す一般ルート、
 * こちらは「その役割で使う前提でログインした」ことが明確な場合の専用ルート）。
 *
 * 判定は user_roles（そのroleのオンボーディング完了記録）のみを見る。
 * profiles.role（legacy）には依存しない。
 *   role登録済み   → 該当のマイページ
 *   role未登録     → 該当のオンボーディング
 *     （オンボーディング完了後は各オンボーディングウィザード自身が
 *      該当マイページへ遷移する。ログイン中なので新規アカウントは
 *      作成されず、同じuser_idにroleが追加される）
 */
export async function determineRoleEntryPath(
  supabase: SupabaseClient<Database>,
  userId: string,
  role: "stylist" | "salon",
): Promise<string> {
  if (await isPlatformAdmin(supabase)) return ADMIN_HOME_PATH;
  const has = await hasCompletedRole(supabase, userId, role);
  if (role === "stylist") {
    return has ? "/stylist/mypage" : "/onboarding";
  }
  return has ? "/salon/mypage" : "/onboarding/salon";
}

/**
 * 管理者専用ログイン入口（/admin/login）の遷移先決定。権限は is_platform_admin()（getAdminStatus）で確認する。
 *   管理者        → /admin（next が /admin 配下の安全なパスならそこへ）
 *   管理者でない  → not_admin（呼び出し側がセッションを破棄して案内する。管理画面へは進ませない）
 *   確認できない  → check_failed（再試行できるエラー）
 * ★メールアドレスの文字列では判定しない。この入口以外からログインした管理者の権限は、これによって変わらない。
 */
export type AdminEntryResult = { ok: true; path: string } | { ok: false; reason: "not_admin" | "check_failed" };
export async function determineAdminEntryPath(
  supabase: SupabaseClient<Database>,
  next?: string | null,
): Promise<AdminEntryResult> {
  const status = await getAdminStatus(supabase);
  if (status === "admin") {
    const safe = next && (next === ADMIN_HOME_PATH || next.startsWith(`${ADMIN_HOME_PATH}/`)) ? next : ADMIN_HOME_PATH;
    return { ok: true, path: safe };
  }
  return { ok: false, reason: status === "not_admin" ? "not_admin" : "check_failed" };
}
