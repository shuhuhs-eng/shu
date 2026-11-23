"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/admin/is-admin";
import { rpc } from "@/lib/messages/rpc";
import { isUuid, parseBody, parseSubject } from "@/lib/messages/shared";
import type { ActionResult } from "@/lib/messages/actions";

/**
 * 新規の連絡スレッドの作成（責任者のみ）。作成画面は会社・美容師の詳細（個人情報）を引くため、
 * スタッフにどこまで見せるか（個人情報の閲覧範囲）が決まるまで責任者に限る。
 * ※DBの admin_create_thread は 0098 で運営に開く案（要判断）。画面と操作はここで責任者に絞る。
 */
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

