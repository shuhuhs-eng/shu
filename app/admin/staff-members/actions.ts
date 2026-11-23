"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createMailProvider } from "@/lib/email/provider";
import { createStaffAuthAdmin, createStaffMailer } from "@/lib/admin/staff-admin";
import { inviteCore, passwordResetCore, renameCore, resendCore, setStatusCore, type ManageDeps, type ManageResult } from "@/lib/admin/staff-manage-core";
import type { RpcFn } from "@/lib/admin/staff-invite";

export type ManageState = ManageResult | null;

/** 責任者のDB確認はRPC側（is_platform_admin）。画面・この関数では権限判定をしない（DBが拒否する）。 */
async function ctx() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const rpc: RpcFn = (name, args) => (supabase as unknown as Pick<SupabaseClient, "rpc">).rpc(name, args) as unknown as ReturnType<RpcFn>;
  return { rpc };
}
function mailDeps(rpc: RpcFn): ManageDeps {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? "";
  const svc = createServiceClient();
  return { rpc, auth: createStaffAuthAdmin(svc.auth.admin as never, site), mailer: createStaffMailer(createMailProvider()) };
}
const NEED_LOGIN: ManageResult = { ok: false, message: "ログインし直してください。" };
const done = (r: ManageResult): ManageResult => { revalidatePath("/admin/staff-members"); return r; };

// 招待（メール送信・認証アカウント作成は service role。権限判定はDBが先に行う: admin_staff_invite_begin が責任者以外を拒否）
export async function inviteStaffAction(_: ManageState, fd: FormData): Promise<ManageState> {
  const c = await ctx(); if (!c) return NEED_LOGIN;
  return done(await inviteCore(mailDeps(c.rpc), { requestId: fd.get("requestId"), email: fd.get("email"), displayName: fd.get("displayName") }));
}
export async function resendStaffAction(_: ManageState, fd: FormData): Promise<ManageState> {
  const c = await ctx(); if (!c) return NEED_LOGIN;
  return done(await resendCore(mailDeps(c.rpc), fd.get("userId")));
}
export async function renameStaffAction(_: ManageState, fd: FormData): Promise<ManageState> {
  const c = await ctx(); if (!c) return NEED_LOGIN;
  return done(await renameCore(c.rpc, fd.get("userId"), fd.get("displayName")));
}
export async function setStaffStatusAction(_: ManageState, fd: FormData): Promise<ManageState> {
  const c = await ctx(); if (!c) return NEED_LOGIN;
  return done(await setStatusCore(c.rpc, fd.get("userId"), fd.get("status"), fd.get("reason")));
}
export async function staffPasswordResetAction(_: ManageState, fd: FormData): Promise<ManageState> {
  const c = await ctx(); if (!c) return NEED_LOGIN;
  return done(await passwordResetCore(mailDeps(c.rpc), fd.get("userId")));
}
// 進行中（登録が完了していない）招待の続き。同じ requestId で再実行するので、二重に作られない。
export async function resumeInviteAction(prev: ManageState, fd: FormData): Promise<ManageState> { return inviteStaffAction(prev, fd); }
