"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { feeErrorMessage } from "@/lib/billing/event-fee";
import { visitFeeEnabled } from "@/lib/billing/visit-fee-flag";

/**
 * 見学・体験入店の料金の操作（責任者のみ。DBの各RPCが is_platform_admin() を再確認する）。
 * DB草案0108（提案・未適用）が前提。適用前に有効にしないよう、サーバー側フラグ VISIT_FEE_ENABLED=1 のときだけ動く。
 * ★ここは「外部で行った決済の結果を記録する」機能で、カード請求・送金は行わない。
 */
type Result = { success: true; data?: Record<string, unknown> } | { success: false; error: string };
const uuid = z.string().uuid();
async function call(fn: string, args: Record<string, unknown>): Promise<Result> {
  if (!visitFeeEnabled()) return { success: false, error: "この機能はまだ有効になっていません。" };
  const supabase = (await createClient()) as unknown as Pick<SupabaseClient, "rpc">;
  const { data, error } = await supabase.rpc(fn, args);
  if (error) { console.error(`[${fn}]`, { code: error.code }); return { success: false, error: feeErrorMessage(error.message) }; }
  revalidatePath("/admin/visit-requests");
  return { success: true, data: (data && typeof data === "object" ? data : undefined) as Record<string, unknown> | undefined };
}
export async function startVisitFeePayment(input: { chargeId: string }): Promise<Result> {
  const p = z.object({ chargeId: uuid }).safeParse(input); if (!p.success) return { success: false, error: "不正なリクエストです。" };
  return call("admin_visit_fee_start_payment", { p_charge_id: p.data.chargeId });
}
export async function finishVisitFeeAttempt(input: { attemptId: string; result: "succeeded" | "failed" | "unknown"; externalRef?: string | null }): Promise<Result> {
  const p = z.object({ attemptId: uuid, result: z.enum(["succeeded", "failed", "unknown"]), externalRef: z.string().trim().min(1).max(200).nullish() }).safeParse(input);
  if (!p.success) return { success: false, error: "入力を確認してください。" };
  return call("admin_visit_fee_finish_attempt", { p_attempt_id: p.data.attemptId, p_result: p.data.result, p_external_ref: p.data.externalRef ?? null });
}
export async function resolveVisitFeeUnknown(input: { attemptId: string; paid: boolean; externalRef?: string | null; note: string }): Promise<Result> {
  const p = z.object({ attemptId: uuid, paid: z.boolean(), externalRef: z.string().trim().min(1).max(200).nullish(), note: z.string().trim().min(1).max(500) }).safeParse(input);
  if (!p.success) return { success: false, error: "確認内容と入力を確認してください。" };
  return call("admin_visit_fee_resolve_unknown", { p_attempt_id: p.data.attemptId, p_paid: p.data.paid, p_external_ref: p.data.externalRef ?? null, p_note: p.data.note });
}
export async function cancelVisitFee(input: { chargeId: string; reason: string }): Promise<Result> {
  const p = z.object({ chargeId: uuid, reason: z.string().trim().min(1).max(500) }).safeParse(input); if (!p.success) return { success: false, error: "取消の理由を入力してください。" };
  return call("admin_visit_fee_cancel", { p_charge_id: p.data.chargeId, p_reason: p.data.reason });
}
