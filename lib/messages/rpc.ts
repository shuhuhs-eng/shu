import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid, mapMessageError } from "@/lib/messages/shared";

type Supa = Pick<SupabaseClient, "rpc">;
export type Result<T> = { ok: true; data: T } | { ok: false; reason: "forbidden" | "not_found" | "error"; message: string };

/** RPCを呼び、例外を「権限なし／見つからない／その他」に分けて返す。取得失敗を0件と見せない。 */
export async function rpc<T>(supabase: Supa, fn: string, args: Record<string, unknown>): Promise<Result<T>> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      const m = String(error.message ?? "");
      const reason = m.includes("admin access required") ? "forbidden" : m.includes("thread not found") || m.includes("login required") ? "not_found" : "error";
      if (reason === "error") console.error("[messages] RPC failed", { fn, code: error.code, message: m });
      return { ok: false, reason, message: mapMessageError(m) };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, reason: "error", message: mapMessageError("") };
  }
}
export const guardUuid = (v: string) => isUuid(v);

// ---- 運営側 ----
export type AdminThreadRow = {
  id: string; audience: "salon" | "stylist"; subject: string; status: string; updated_at: string;
  organization_id: string | null; organization_name: string | null; store_id: string | null; store_name: string | null;
  visit_case_id: string | null; recipient_user_id: string | null; recipient_access_lost: boolean; delivery_failed: boolean;
};
export type AdminMessage = {
  id: string; kind: "to_recipient" | "from_recipient" | "internal_note" | "offline_log"; author_user_id: string; author_name: string | null; body: string; created_at: string;
  delivery: { status: string; error_code: string | null; attempts: number } | null;
};
export type AdminThreadDetail = {
  thread: { id: string; audience: "salon" | "stylist"; subject: string; status: string; organization_id: string | null; store_id: string | null; recipient_user_id: string | null;
    created_at: string; recipient_access_lost: boolean; salon_reader_count: number | null };
  messages: AdminMessage[];
};
export const adminListThreads = (s: Supa, a: { status?: string | null; organizationId?: string | null; limit: number; offset: number }) =>
  rpc<{ total: number; rows: AdminThreadRow[] }>(s, "admin_list_threads", { p_status: a.status ?? null, p_organization_id: a.organizationId ?? null, p_limit: a.limit, p_offset: a.offset });
export const adminGetThread = (s: Supa, id: string) =>
  guardUuid(id) ? rpc<AdminThreadDetail>(s, "admin_get_thread", { p_thread_id: id }) : Promise.resolve<Result<AdminThreadDetail>>({ ok: false, reason: "not_found", message: mapMessageError("thread not found") });

// ---- 相手側（サロン・美容師）。返ってくるのは「相手に見せる本文」だけ ----
export type InboxRow = { id: string; subject: string; last_message_at: string; needs_reply: boolean; closed: boolean; organization_name: string | null; store_name: string | null };
export type InboxMessage = { id: string; from_admin: boolean; is_mine: boolean; author_label: string; body: string; created_at: string };
export type InboxThread = { id: string; subject: string; closed: boolean; can_reply: boolean; needs_reply: boolean; organization_name: string | null; store_name: string | null; messages: InboxMessage[] };
export const inboxList = (s: Supa, limit: number, offset: number) => rpc<{ total: number; rows: InboxRow[] }>(s, "inbox_list_threads", { p_limit: limit, p_offset: offset });
export const inboxGet = (s: Supa, id: string) =>
  guardUuid(id) ? rpc<InboxThread>(s, "inbox_get_thread", { p_thread_id: id }) : Promise.resolve<Result<InboxThread>>({ ok: false, reason: "not_found", message: mapMessageError("thread not found") });
