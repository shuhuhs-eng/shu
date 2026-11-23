"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseStaffLinkParams } from "@/lib/admin/staff-link";
import { getOperatorState } from "@/lib/admin/operator";
import { STAFF_SUSPENDED_PATH } from "@/lib/admin/operator-state";
import { STAFF_PASSWORD_PATH } from "@/lib/admin/staff-link";

export type LinkState = { error: string | null };

/**
 * リンクのボタンが押されたときだけ、トークンを消費してセッションを作る（開いただけでは消費しない）。
 * 別の人でログイン中でも、押した時点でその人をログアウトしてからリンクの本人として入る（確認はページで表示済み）。
 * 無効（期限切れ・使用済み）の理由は詳しく出さない。
 */
export async function consumeStaffLinkAction(_: LinkState, fd: FormData): Promise<LinkState> {
  const p = parseStaffLinkParams({ token_hash: fd.get("token_hash")?.toString(), type: fd.get("type")?.toString() });
  if (!p.ok) return { error: "リンクが正しくありません。招待メールのリンクを、もう一度開いてください。" };
  const supabase = await createClient();
  await supabase.auth.signOut();
  const { error } = await supabase.auth.verifyOtp({ token_hash: p.tokenHash, type: p.type });
  if (error) return { error: "このリンクは無効です（期限切れ、または使用済み）。責任者に再招待（またはパスワード再設定）を依頼してください。" };
  const state = await getOperatorState(supabase);
  if (state === "staff_suspended") redirect(STAFF_SUSPENDED_PATH);
  redirect(STAFF_PASSWORD_PATH);
}

export async function linkSignOutAction(fd: FormData): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const back = fd.get("back")?.toString() ?? "";
  redirect(back.startsWith("/auth/staff-invite") && !back.startsWith("//") ? back : "/");
}
