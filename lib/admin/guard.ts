import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/admin/is-admin";
import { getOperatorState } from "@/lib/admin/operator";
import { operatorHomePath } from "@/lib/admin/operator-state";

/**
 * 責任者専用の運営ページ・データ取得の入口で呼ぶ（請求・契約・個人情報の一覧・権限・設定など）。
 *   未ログイン → ログインへ（元のパスへ戻る）／責任者でない →
 *     スタッフなら状態に応じたスタッフ用の画面へ、それ以外は一般のマイページへ。
 * データ取得そのものもDB側のRPCが is_platform_admin() を再確認する（画面だけに頼らない）。
 */
export async function requireAdminPage(nextPath: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (!(await isPlatformAdmin(supabase))) {
    const home = operatorHomePath(await getOperatorState(supabase));
    redirect(home && !home.startsWith("/admin/login") ? home : "/mypage");
  }
  return { supabase, user };
}
