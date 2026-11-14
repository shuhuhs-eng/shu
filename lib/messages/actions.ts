"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/admin/is-admin";
import { rpc } from "@/lib/messages/rpc";
import { REOPEN_STATUSES, isUuid, parseBody, parseSubject } from "@/lib/messages/shared";

/**
 * 連絡のサーバー処理。★通知メールは送らない（送信設定・送信先の確認後に別途）。
 * 作成・投稿・返信は「結果」を返す（失敗しても画面は入力と送信IDを保持し、同じ内容で再送できる）。
 * 権限はDB側が再確認する。送信IDはクライアントが保持する（成功を確認するまで変えない）。
 */
export type ActionResult = { ok: true; threadId?: string } | { ok: false; error: string };
const fail = (error: string): ActionResult => ({ ok: false, error });
const s = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v : ""; };

export async function createThreadAction(fd: FormData): Promise<ActionResult> {
  const rid = s(fd, "rid");
  const audience = s(fd, "audience");
  const org = s(fd, "organization_id"), store = s(fd, "store_id"), rcp = s(fd, "recipient_user_id");
  if (!isUuid(rid)) return fail("画面を開き直してください。");
  if (audience !== "salon" && audience !== "stylist") return fail("宛先の種類を確認してください。");
  const subject = parseSubject(s(fd, "subject")); if (!subject.ok) return fail(subject.error);
  const body = parseBody(s(fd, "body")); if (!body.ok) return fail(body.error);
  for (const v of [org, store, rcp]) if (v && !isUuid(v)) return fail("宛先の指定が正しくありません。");
  if (audience === "salon" && !org) return fail("会社を指定してください。");
  if (audience === "stylist" && !rcp) return fail("美容師を指定してください。");
  const supabase = await createClient();
  if (!(await isPlatformAdmin(supabase))) return fail("この操作を行う権限がありません。");
  const res = await rpc<string>(supabase, "admin_create_thread", {
    p_request_id: rid, p_audience: audience, p_recipient_user_id: rcp || null, p_organization_id: org || null, p_store_id: store || null,
    p_visit_case_id: null, p_subject: subject.value, p_body: body.value,
  });
  if (!res.ok) return fail(res.message);
  revalidatePath("/admin/messages");
  return { ok: true, threadId: res.data };
}

export async function postAdminMessageAction(fd: FormData): Promise<ActionResult> {
  const rid = s(fd, "rid"), thread = s(fd, "thread_id"), kind = s(fd, "kind");
  if (!isUuid(rid) || !isUuid(thread)) return fail("画面を開き直してください。");
  if (!["to_recipient", "internal_note", "offline_log"].includes(kind)) return fail("種類を確認してください。");
  const body = parseBody(s(fd, "body")); if (!body.ok) return fail(body.error);
  const supabase = await createClient();
  if (!(await isPlatformAdmin(supabase))) return fail("この操作を行う権限がありません。");
  const res = await rpc<unknown>(supabase, "admin_post_message", { p_request_id: rid, p_thread_id: thread, p_kind: kind, p_body: body.value });
  if (!res.ok) return fail(res.message);
  revalidatePath(`/admin/messages/${thread}`);
  return { ok: true };
}

export async function inboxReplyAction(fd: FormData): Promise<ActionResult> {
  const rid = s(fd, "rid"), thread = s(fd, "thread_id");
  if (!isUuid(rid) || !isUuid(thread)) return fail("画面を開き直してください。");
  const body = parseBody(s(fd, "body")); if (!body.ok) return fail(body.error);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("ログインし直してください。");
  const res = await rpc<unknown>(supabase, "inbox_reply", { p_request_id: rid, p_thread_id: thread, p_body: body.value });
  if (!res.ok) return fail(res.message);
  revalidatePath(`/messages/${thread}`); revalidatePath("/messages");
  return { ok: true };
}

/** 完了・再開（本文なし・同じ操作を繰り返しても結果は同じ）。失敗は画面上部に表示して同じ画面へ戻る。 */
export async function setThreadStatusAction(fd: FormData) {
  const thread = s(fd, "thread_id"), status = s(fd, "status");
  const path = `/admin/messages/${thread}`;
  if (!isUuid(thread)) redirect("/admin/messages");
  const back = (err: string): never => redirect(`${path}?${new URLSearchParams({ err }).toString()}`);
  if (status !== "done" && !(REOPEN_STATUSES as readonly string[]).includes(status)) return back("状態を確認してください。");
  const supabase = await createClient();
  if (!(await isPlatformAdmin(supabase))) return back("この操作を行う権限がありません。");
  const res = await rpc<unknown>(supabase, "admin_set_thread_status", { p_thread_id: thread, p_status: status });
  if (!res.ok) return back(res.message);
  revalidatePath(path); revalidatePath("/admin/messages");
  redirect(path);
}
