import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isOperatorList, isWorkRecordList, type OperatorEntry, type WorkRecord } from "@/lib/admin/work-log";

type Supa = Pick<SupabaseClient, "rpc">;
/** 運営一覧（名前解決・担当者の選択肢）。取得できないときは ok:false（空配列にしない）。 */
export async function loadOperators(supabase: Supa): Promise<{ ok: true; data: OperatorEntry[] } | { ok: false }> {
  try { const { data, error } = await supabase.rpc("admin_operator_directory"); return !error && isOperatorList(data) ? { ok: true, data } : { ok: false }; } catch { return { ok: false }; }
}
export async function loadWorkRecords(supabase: Supa, entityType: string, entityId: string): Promise<{ ok: true; data: WorkRecord[] } | { ok: false }> {
  try { const { data, error } = await supabase.rpc("admin_work_records_for", { p_entity_type: entityType, p_entity_id: entityId, p_limit: 100 }); return !error && isWorkRecordList(data) ? { ok: true, data } : { ok: false }; } catch { return { ok: false }; }
}
