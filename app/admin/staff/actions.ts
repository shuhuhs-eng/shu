"use server";

import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOperatorState } from "@/lib/admin/operator";
import { STAFF_HOME_PATH } from "@/lib/admin/operator-state";

export type AcceptState = { error: string | null };

/** 招待の承諾。メール確認済み・期限内・招待中の本人だけがDB側で通る（画面の状態に頼らない）。成功したら運営ホームへ。 */
export async function acceptStaffInvitationAction(): Promise<AcceptState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "ログインし直してください。" };
  // 型定義(types/database)に無い新しいRPCなので、型を緩めて呼ぶ（DB適用後に型を再生成する）。
  const { error } = await (supabase as unknown as Pick<SupabaseClient, "rpc">).rpc("admin_staff_accept");
  if (error) {
    const m = String(error.message ?? "");
    if (m.includes("invitation expired")) return { error: "招待の有効期限が切れています。責任者に再招待を依頼してください。" };
    if (m.includes("email not confirmed")) return { error: "メールアドレスの確認が完了していません。招待メールのリンクから手続きを完了してください。" };
    if (m.includes("no pending invitation")) {
      const st = await getOperatorState(supabase);
      if (st === "staff_active") redirect(STAFF_HOME_PATH);
      return { error: "承諾できる招待がありません。" };
    }
    return { error: "承諾を完了できませんでした。時間をおいて、もう一度お試しください。" };
  }
  redirect(STAFF_HOME_PATH);
}

/** スタッフ状態画面用のログアウト（一般の signOutAction は重い依存を持つため、状態画面専用に分ける）。 */
export async function staffSignOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
