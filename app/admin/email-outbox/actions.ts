"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/admin/guard";
import { looseRpc } from "@/lib/diagnosis-limit/rpc";

const ACTIONS = new Set(["requeue", "mark_delivered", "mark_not_delivered", "mark_undeliverable", "annotate", "enqueue_missing"]);
const BASIS_DELIVERED = new Set(["provider_accepted", "inbox_confirmed"]);
// 「受理されていない」（再送してよい）と「受理後の不達」（自動で再送しない）は別の判断。根拠も混ぜない
const BASIS_NOT_DELIVERED = new Set(["provider_not_accepted"]);
const BASIS_UNDELIVERABLE = new Set(["provider_bounced", "provider_rejected"]);
const BASIS_ANNOTATE = new Set(["provider_delayed", "checking"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 運営の操作。権限はDB側（is_platform_admin）でも確認される。結果は ?r= で画面に返す。 */
export async function emailOutboxAction(formData: FormData) {
  const { supabase } = await requireAdminPage("/admin/email-outbox");
  const action = String(formData.get("action") ?? ""), id = String(formData.get("id") ?? "");
  const basis = String(formData.get("basis") ?? "");
  const note = String(formData.get("note") ?? "").slice(0, 200);
  let r = "invalid";
  // 結果不明の判断は「何を根拠にしたか」が必須（受信箱に無いだけでは「受理されていない」とは言えないため、根拠の選択肢に含めない）
  const basisOk = action === "mark_delivered" ? BASIS_DELIVERED.has(basis) : action === "mark_not_delivered" ? BASIS_NOT_DELIVERED.has(basis)
    : action === "mark_undeliverable" ? BASIS_UNDELIVERABLE.has(basis) : action === "annotate" ? BASIS_ANNOTATE.has(basis) : true;
  const ref = String(formData.get("provider_ref") ?? "").trim().slice(0, 200);
  if (ACTIONS.has(action) && UUID.test(id) && basisOk) {
    const { error } = await looseRpc(supabase).rpc("admin_email_outbox_action", { p_id: id, p_action: action, p_basis: basis || null, p_note: note || null, p_provider_ref: ref || null });
    r = error ? "failed" : "ok";
  }
  revalidatePath("/admin/email-outbox");
  redirect(`/admin/email-outbox?r=${r}`);
}

export async function setEmailEnabledAction(formData: FormData) {
  const { supabase } = await requireAdminPage("/admin/email-outbox");
  const enable = formData.get("enable") === "1";
  const confirmed = formData.get("confirm") === "yes";
  let r = "invalid";
  if (confirmed) {
    const { error } = await looseRpc(supabase).rpc("admin_set_email_notifications_enabled", { p_enabled: enable });
    r = error ? "failed" : "ok";
  }
  revalidatePath("/admin/email-outbox");
  redirect(`/admin/email-outbox?r=${r}`);
}
