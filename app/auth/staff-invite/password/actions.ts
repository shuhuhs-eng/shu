"use server";

import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOperatorState } from "@/lib/admin/operator";
import { operatorHomePath } from "@/lib/admin/operator-state";
import { updatePasswordSchema } from "@/lib/validation/auth";

export type PasswordState = { error: string | null; fieldError?: string };

/**
 * リンクで入った本人が、自分でパスワードを決める。招待中なら続けて承諾（DBが期限・メール確認・本人を確認）。
 * 責任者・メール・ログには、パスワードを出さない。
 */
export async function setStaffPasswordAction(_: PasswordState, fd: FormData): Promise<PasswordState> {
  const parsed = updatePasswordSchema.safeParse({ password: fd.get("password"), confirmPassword: fd.get("confirmPassword") });
  if (!parsed.success) return { error: null, fieldError: parsed.error.issues[0]?.message ?? "パスワードを確認してください。" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "リンクの有効な状態ではありません。招待メールのリンクを開き直してください。" };
  const state0 = await getOperatorState(supabase);
  if (state0 !== "staff_invited" && state0 !== "staff_active") return { error: "この操作を行えるスタッフの状態ではありません。責任者にご確認ください。" };
  const { error: upErr } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (upErr) return { error: "パスワードを設定できませんでした。別のパスワードでお試しください。" };
  if (state0 === "staff_invited") {
    const { error } = await (supabase as unknown as Pick<SupabaseClient, "rpc">).rpc("admin_staff_accept");
    if (error) {
      const m = String(error.message ?? "");
      if (m.includes("invitation expired")) return { error: "招待の有効期限が切れています。責任者に再招待を依頼してください。" };
      return { error: "パスワードは設定しました。招待の承諾を完了できませんでした。画面を再読み込みして、もう一度お試しください。" };
    }
  }
  redirect(operatorHomePath(await getOperatorState(supabase)) ?? "/");
}
