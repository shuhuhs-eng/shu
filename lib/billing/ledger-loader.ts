import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingSetting } from "@/lib/billing/hire-agreement";
import type { Campaign, LedgerDetail, LedgerSummaryRow } from "@/lib/billing/ledger";
import { listSettings, type Loaded } from "@/lib/billing/hire-loader";

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

export const loadSummary = (s: Rpc, page: number, size = 50) => rpc<{ total: number; unset_registration?: number; rows: LedgerSummaryRow[] }>(s, "admin_scout_ledger_summary", { p_limit: size, p_offset: (page - 1) * size },
  (v): v is { total: number; unset_registration?: number; rows: LedgerSummaryRow[] } => isObj(v) && typeof v.total === "number" && Array.isArray(v.rows));
/** 法人が存在しなければ data=null。 */
export const loadEntries = (s: Rpc, org: string, page: number, size = 50) => rpc<LedgerDetail | null>(s, "admin_scout_ledger_entries", { p_org: org, p_limit: size, p_offset: (page - 1) * size },
  (v): v is LedgerDetail | null => v === null || (isObj(v) && Array.isArray(v.rows)));
export type RegistrationInfo = { plans: { code: string; label: string; fee_incl_tax: number; initial_grant: number }[]; registration: { plan_code: string; fee_incl_tax: number; initial_grant: number; selected_at: string } | null; locked: boolean };
export const loadRegistration = (s: Rpc, org: string) => rpc<RegistrationInfo>(s, "admin_scout_registration", { p_org: org },
  (v): v is RegistrationInfo => isObj(v) && Array.isArray(v.plans) && typeof v.locked === "boolean");
export type ExpiryRun = { ran_at: string; source: "cron" | "admin"; orgs_checked: number; entries_created: number; units_expired: number; orgs_failed: number };
export const loadExpiryRuns = (s: Rpc, limit = 14) => rpc<ExpiryRun[]>(s, "admin_scout_expiry_runs", { p_limit: limit }, (v): v is ExpiryRun[] => Array.isArray(v));
export type PaymentIssues = { unresolved_count: number; unattributed_count: number; checkouts_needing_review: number };
export const loadPaymentIssues = (s: Rpc, org: string) => rpc<PaymentIssues>(s, "admin_scout_payment_issues", { p_org: org }, (v): v is PaymentIssues => isObj(v) && typeof v.unresolved_count === "number");
export const loadCampaigns = (s: Rpc) => rpc<Campaign[]>(s, "admin_scout_campaigns_list", {}, (v): v is Campaign[] => Array.isArray(v));
export const loadSettings = (s: Rpc): Promise<Loaded<BillingSetting[]>> => listSettings(s);
