import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgreementDetail, AgreementRow, BillingSetting, BillingSettingChange, IntegrityItem, SalonAgreementView } from "@/lib/billing/hire-agreement";

/** 取得の失敗を「0件」にしない。forbidden=権限なし／unavailable=DBの機能が未適用／error=その他。 */
export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "forbidden" | "unavailable" | "error" };
type Rpc = Pick<SupabaseClient, "rpc">;

function classify(error: { message?: string; code?: string } | null): "forbidden" | "unavailable" | "error" {
  const m = error?.message ?? "";
  if (/admin access required|insufficient permission|permission denied|responsible only/.test(m)) return "forbidden";
  if (error?.code === "PGRST202" || error?.code === "42883" || /could not find the function|does not exist/.test(m)) return "unavailable";
  return "error";
}
async function rpc<T>(supabase: Rpc, fn: string, args: Record<string, unknown>, guard: (v: unknown) => v is T): Promise<Loaded<T>> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { ok: false, reason: classify(error) };
    return guard(data) ? { ok: true, data } : { ok: false, reason: "error" };
  } catch { return { ok: false, reason: "error" }; }
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function listAgreements(supabase: Rpc, view: "all" | "attention", page: number, size = 50) {
  return rpc<{ total: number; rows: AgreementRow[] }>(supabase, "admin_hire_agreements_list", { p_view: view, p_limit: size, p_offset: (page - 1) * size },
    (v): v is { total: number; rows: AgreementRow[] } => isObj(v) && typeof v.total === "number" && Array.isArray(v.rows));
}
export function getAgreement(supabase: Rpc, id: string) {
  return rpc<AgreementDetail>(supabase, "admin_hire_agreement_get", { p_agreement_id: id }, (v): v is AgreementDetail => isObj(v) && isObj(v.agreement));
}
export function listSettings(supabase: Rpc) {
  return rpc<BillingSetting[]>(supabase, "admin_billing_settings_list", {}, (v): v is BillingSetting[] => Array.isArray(v));
}
/** 課金設定の変更履歴（責任者のみ。DB 0112 が未適用なら unavailable）。 */
export function listSettingChanges(supabase: Rpc, limit = 30) {
  return rpc<BillingSettingChange[]>(supabase, "admin_billing_setting_changes_list", { p_limit: limit }, (v): v is BillingSettingChange[] => Array.isArray(v));
}
/** サロン側。契約が開かれていなければ data=null。 */
export function getSalonAgreement(supabase: Rpc, hiringProcessId: string) {
  return rpc<SalonAgreementView | null>(supabase, "company_hire_agreement_get", { p_hiring_process_id: hiringProcessId }, (v): v is SalonAgreementView | null => v === null || isObj(v));
}
/** 新旧の整合の確認（責任者のみ）。取得失敗を「問題なし」にしない。 */
export function getIntegrity(supabase: Rpc) {
  return rpc<IntegrityItem[]>(supabase, "admin_hire_integrity_check", {}, (v): v is IntegrityItem[] => Array.isArray(v));
}
