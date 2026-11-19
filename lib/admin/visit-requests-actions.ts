"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { visitErrorMessage } from "@/lib/admin/visit-requests-shared";

type Result = { success: true; id?: string } | { success: false; error: string };

const uuid = z.string().uuid();

export async function claimVisitRequest(input: { sourceKind: "scout_reply" | "direct_interest"; sourceId: string }): Promise<Result> {
  const p = z.object({ sourceKind: z.enum(["scout_reply", "direct_interest"]), sourceId: uuid }).safeParse(input);
  if (!p.success) return { success: false, error: "不正なリクエストです。" };
  const supabase = (await createClient()) as unknown as Pick<SupabaseClient, "rpc">;   // 0087は未適用のため型定義にまだ無い
  const { data, error } = await supabase.rpc("admin_claim_visit_request", { p_source_kind: p.data.sourceKind, p_source_id: p.data.sourceId });
  if (error) { console.error("[claimVisitRequest]", { code: error.code }); return { success: false, error: visitErrorMessage(error.message) }; }
  revalidatePath("/admin/visit-requests");
  return { success: true, id: typeof data === "string" ? data : undefined };
}

const updateSchema = z.object({
  id: uuid, status: z.enum(["received", "reviewing", "scheduling", "scheduled", "post_visit_check", "attended", "closed"]),
  expectedUpdatedAt: z.string().min(1), scheduledOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  note: z.string().max(2000).nullable(), closedReason: z.enum(["not_held", "declined", "duplicate", "cancelled", "other"]).nullable(), mergedInto: uuid.nullable(),
});
export async function updateVisitRequest(input: z.infer<typeof updateSchema>): Promise<Result> {
  const p = updateSchema.safeParse(input);
  if (!p.success) return { success: false, error: "入力を確認してください。" };
  const supabase = (await createClient()) as unknown as Pick<SupabaseClient, "rpc">;   // 0087は未適用のため型定義にまだ無い
  const { error } = await supabase.rpc("admin_update_visit_request", {
    p_id: p.data.id, p_status: p.data.status, p_expected_updated_at: p.data.expectedUpdatedAt, p_scheduled_on: p.data.scheduledOn,
    p_internal_note: p.data.note, p_closed_reason: p.data.closedReason, p_merged_into: p.data.mergedInto,
  });
  if (error) { console.error("[updateVisitRequest]", { code: error.code }); return { success: false, error: visitErrorMessage(error.message) }; }
  revalidatePath("/admin/visit-requests"); revalidatePath(`/admin/visit-requests/${p.data.id}`);
  return { success: true };
}

const confirmSchema = z.object({ requestId: uuid, party: z.enum(["salon", "stylist"]), result: z.enum(["held", "not_held"]), channel: z.enum(["message", "phone", "other"]), note: z.string().max(1000).nullable() });
export async function recordVisitConfirmation(input: z.infer<typeof confirmSchema>): Promise<Result> {
  const p = confirmSchema.safeParse(input);
  if (!p.success) return { success: false, error: "入力を確認してください。" };
  const supabase = (await createClient()) as unknown as Pick<SupabaseClient, "rpc">;   // 0087は未適用のため型定義にまだ無い
  const { error } = await supabase.rpc("admin_record_visit_confirmation", { p_request_id: p.data.requestId, p_party: p.data.party, p_result: p.data.result, p_channel: p.data.channel, p_note: p.data.note });
  if (error) { console.error("[recordVisitConfirmation]", { code: error.code }); return { success: false, error: visitErrorMessage(error.message) }; }
  revalidatePath(`/admin/visit-requests/${p.data.requestId}`); revalidatePath("/admin/visit-requests");
  return { success: true };
}

const assignSchema = z.object({ id: uuid, adminId: uuid.nullable(), expectedUpdatedAt: z.string().min(1) });
export async function assignVisitRequest(input: z.infer<typeof assignSchema>): Promise<Result> {
  const p = assignSchema.safeParse(input);
  if (!p.success) return { success: false, error: "入力を確認してください。" };
  const supabase = (await createClient()) as unknown as Pick<SupabaseClient, "rpc">;   // 0087は未適用のため型定義にまだ無い
  const { error } = await supabase.rpc("admin_assign_visit_request", { p_id: p.data.id, p_admin: p.data.adminId, p_expected_updated_at: p.data.expectedUpdatedAt });
  if (error) { console.error("[assignVisitRequest]", { code: error.code }); return { success: false, error: visitErrorMessage(error.message) }; }
  revalidatePath("/admin/visit-requests"); revalidatePath(`/admin/visit-requests/${p.data.id}`);
  return { success: true };
}
