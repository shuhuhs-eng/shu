"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/admin/is-admin";
import { rpc } from "@/lib/messages/rpc";
import { REOPEN_STATUSES, isUuid, parseBody, parseSubject } from "@/lib/messages/shared";

/**
 * 連絡のサーバー処理。★通知メールは送らない（送信設定・送信先の確認後に別途）。
 * 失敗時は同じ送信ID(rid)を付けて元の画面へ戻す（結果が不明なときの再送が二重にならないように）。
 * 成功時は新しい画面へ（新しい送信ID）。権限はDB側が再確認する。
 */
const s = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v : ""; };
const back = (path: string, rid: string, err: string): never =>
  redirect(`${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ rid, err }).toString()}`);

async function adminOr(path: string, rid: string) {
  const supabase = await createClient();
  if (!(await isPlatformAdmin(supabase))) return back(path, rid, "この操作を行う権限がありません。");
  return supabase;
}

export async function createThreadAction(fd: FormData) {
  const rid = s(fd, "rid");
  const audience = s(fd, "audience");
  const org = s(fd, "organization_id"), store = s(fd, "store_id"), rcp = s(fd, "recipient_user_id");
  const path = `/admin/messages/new?${new URLSearchParams([["audience", audience], ...(org ? [["org", org]] : []), ...(store ? [["store", store]] : []), ...(rcp ? [["recipient", rcp]] : [])]).toString()}`;
  if (!isUuid(rid)) return back(path, crypto.randomUUID(), "もう一度お試しください。");
  if (audience !== "salon" && audience !== "stylist") return back(path, rid, "宛先の種類を確認してください。");
  const subject = parseSubject(s(fd, "subject")); if (!subject.ok) return back(path, rid, subject.error);
  const body = parseBody(s(fd, "body")); if (!body.ok) return back(path, rid, body.error);
  const ids = { org, store, rcp };
  for (const [k, v] of Object.entries(ids)) if (v && !isUuid(v)) return back(path, rid, `宛先の指定（${k}）が正しくありません。`);
  if (audience === "salon" && !org) return back(path, rid, "会社を指定してください。");
  if (audience === "stylist" && !rcp) return back(path, rid, "美容師を指定してください。");
  const supabase = await adminOr(path, rid);
  const res = await rpc<string>(supabase, "admin_create_thread", {
    p_request_id: rid, p_audience: audience, p_recipient_user_id: rcp || null, p_organization_id: org || null, p_store_id: store || null,
    p_visit_case_id: null, p_subject: subject.value, p_body: body.value,
  });
  if (!res.ok) return back(path, rid, res.message);
  revalidatePath("/admin/messages");
  redirect(`/admin/messages/${res.data}`);
}

export async function postAdminMessageAction(fd: FormData) {
  const rid = s(fd, "rid"), thread = s(fd, "thread_id");
  const path = `/admin/messages/${thread}`;
  if (!isUuid(thread)) redirect("/admin/messages");
  if (!isUuid(rid)) return back(path, crypto.randomUUID(), "もう一度お試しください。");
  const kind = s(fd, "kind");
  if (!["to_recipient", "internal_note", "offline_log"].includes(kind)) return back(path, rid, "種類を確認してください。");
  const body = parseBody(s(fd, "body")); if (!body.ok) return back(path, rid, body.error);
  const supabase = await adminOr(path, rid);
  const res = await rpc<unknown>(supabase, "admin_post_message", { p_request_id: rid, p_thread_id: thread, p_kind: kind, p_body: body.value });
  if (!res.ok) return back(path, rid, res.message);
  revalidatePath(path);
  redirect(path);
}

export async function setThreadStatusAction(fd: FormData) {
  const thread = s(fd, "thread_id"), status = s(fd, "status"), rid = s(fd, "rid") || "x";
  const path = `/admin/messages/${thread}`;
  if (!isUuid(thread)) redirect("/admin/messages");
  if (status !== "done" && !(REOPEN_STATUSES as readonly string[]).includes(status)) return back(path, rid, "状態を確認してください。");
  const supabase = await adminOr(path, rid);
  const res = await rpc<unknown>(supabase, "admin_set_thread_status", { p_thread_id: thread, p_status: status });
  if (!res.ok) return back(path, rid, res.message);
  revalidatePath(path); revalidatePath("/admin/messages");
  redirect(path);
}

export async function inboxReplyAction(fd: FormData) {
  const rid = s(fd, "rid"), thread = s(fd, "thread_id");
  const path = `/messages/${thread}`;
  if (!isUuid(thread)) redirect("/messages");
  if (!isUuid(rid)) return back(path, crypto.randomUUID(), "もう一度お試しください。");
  const body = parseBody(s(fd, "body")); if (!body.ok) return back(path, rid, body.error);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  const res = await rpc<unknown>(supabase, "inbox_reply", { p_request_id: rid, p_thread_id: thread, p_body: body.value });
  if (!res.ok) return back(path, rid, res.message);
  revalidatePath(path); revalidatePath("/messages");
  redirect(path);
}
