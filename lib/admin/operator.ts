import type { SupabaseClient } from "@supabase/supabase-js";
import { parseOperatorState, type OperatorState } from "@/lib/admin/operator-state";

/** 自分の運営での状態（画面の出し分け用）。確認できなかったときは "error"（運営でないと決めつけない）。 */
export async function getOperatorState(supabase: Pick<SupabaseClient, "rpc">): Promise<OperatorState> {
  try {
    const { data, error } = await supabase.rpc("admin_my_operator_state");
    if (error) return "error";
    return parseOperatorState(data);
  } catch {
    return "error";
  }
}

/** 運営（責任者または有効なスタッフ）か。DB側 is_admin_operator() の確認（セッション照合を含む）。確認できなければ false（安全側）。 */
export async function isAdminOperator(supabase: Pick<SupabaseClient, "rpc">): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("is_admin_operator");
    return !error && data === true;
  } catch {
    return false;
  }
}
