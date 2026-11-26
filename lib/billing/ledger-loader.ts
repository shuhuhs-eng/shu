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

export const loadSummary = (s: Rpc, page: number, size = 50) => rpc<{ total: number; rows: LedgerSummaryRow[] }>(s, "admin_scout_ledger_summary", { p_limit: size, p_offset: (page - 1) * size },
  (v): v is { total: number; rows: LedgerSummaryRow[] } => isObj(v) && typeof v.total === "number" && Array.isArray(v.rows));
/** 法人が存在しなければ data=null。 */
export const loadEntries = (s: Rpc, org: string, page: number, size = 50) => rpc<LedgerDetail | null>(s, "admin_scout_ledger_entries", { p_org: org, p_limit: size, p_offset: (page - 1) * size },
  (v): v is LedgerDetail | null => v === null || (isObj(v) && Array.isArray(v.rows)));
export const loadCampaigns = (s: Rpc) => rpc<Campaign[]>(s, "admin_scout_campaigns_list", {}, (v): v is Campaign[] => Array.isArray(v));
export const loadSettings = (s: Rpc): Promise<Loaded<BillingSetting[]>> => listSettings(s);
