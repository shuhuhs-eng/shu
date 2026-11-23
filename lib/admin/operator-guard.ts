import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOperatorState } from "@/lib/admin/operator";
import { canEnterOperations, operatorHomePath } from "@/lib/admin/operator-state";

/**
 * 運営ページの入口（責任者＋承諾済みで有効なスタッフが使う通常業務の画面）。
 *   未ログイン → ログインへ／運営でない → 一般のマイページへ／
 *   スタッフの招待中・停止中・再ログイン待ち → それぞれの専用画面へ。
 * ★画面の出し分けだけに頼らない: データ取得のRPCがDBで is_admin_operator() を再確認する（セッション照合を含む）。
 */
export async function requireAdminOperator(nextPath: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  const state = await getOperatorState(supabase);
  if (!canEnterOperations(state)) redirect(operatorHomePath(state) ?? "/mypage");
  return { supabase, user, state };
}
