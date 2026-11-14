import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/admin/is-admin";

/**
 * 運営画面のページ・データ取得の入口で呼ぶ。
 *   未ログイン → ログインへ（元のパスへ戻る）／運営者でない → 一般のマイページへ。
 * データ取得そのものもDB側のRPCが is_platform_admin() を再確認する（画面だけに頼らない）。
 */
export async function requireAdminPage(nextPath: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (!(await isPlatformAdmin(supabase))) redirect("/mypage");
  return { supabase, user };
}
