import "server-only";
import type { RegionRow } from "@/lib/area/regions";
import { fetchAllPaged, type PageResult } from "@/lib/area/paging";

/** 有効な地域マスターの全行（認証済み利用者は読み取り可。RLSは using(true)）。有効版が無ければ null。 */
export async function fetchActiveRegionRows(supabase: unknown): Promise<{ version: string; rows: RegionRow[] } | null> {
  const sb = supabase as { from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => PromiseLike<{ data: unknown; error: unknown }> } } };
  const v = await (sb.from("region_master_versions").select("version_id") as unknown as { eq: (c: string, v: string) => { maybeSingle: () => PromiseLike<{ data: { version_id?: string } | null; error: unknown }> } }).eq("status", "active").maybeSingle();
  const version = v.data?.version_id;
  if (v.error || !version) return null;
  const COLS = "code, level, pref_code, parent_code, name, has_wards, valid_from, valid_to";
  type Q = { select: (c: string, o: { count: "exact" }) => { eq: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => { range: (a: number, b: number) => PromiseLike<PageResult<RegionRow>> } } } };
  const q = sb.from("region_master") as unknown as Q;
  // 一意キー(code)で並びを固定し、1,000件ごとに取得。件数と一致しなければ失敗(null)。
  const rows = await fetchAllPaged<RegionRow>(
    (from, to) => q.select(COLS, { count: "exact" }).eq("version_id", version).order("code", { ascending: true }).range(from, to),
    { pageSize: 1000, keyOf: (r) => r.code },
  );
  if (!rows || rows.length === 0) return null; // 取得失敗・空のマスターは「地域が選べない」状態として扱う
  return { version, rows };
}
