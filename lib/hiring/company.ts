import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getStoreHiringProcesses } from "@/lib/hiring/actions";
import type { StoreHiringProcess } from "@/lib/hiring/types";

/**
 * 会社横断の採用ダッシュボード（Phase 10）用の読み取り・集計。
 *
 * ★新しいDBは使わない。アクセスできる店舗ごとに get_store_hiring_processes を
 * 呼んで、アプリ側で集計する。各RPCが is_store_accessible を再検証するため、
 * ここでの店舗の絞り込みを誤っても、権限の無い店舗のデータは返らない。
 * ★organization_idは salon_stores.organization_id から解決する（重複保存しない）。
 */
export type CompanyStore = {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string | null;
};

export type CompanyHiringRow = StoreHiringProcess & { storeName: string };

/**
 * このユーザーが会社横断で見てよい店舗を求める。
 *   ・company_owner / company_admin / recruiting_admin → その会社の全店舗
 *   ・area_manager → その会社のうち store_members に割当のある店舗だけ
 *   ・会社レベルの役割が無い → null（会社横断画面には入れない）
 * salon_stores のSELECTはRLS(is_store_accessible)で既に絞り込まれている。
 */
export async function getCompanyHiringScope(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<CompanyStore[] | null> {
  const { data: memberships } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId);
  const roleByOrg = new Map<string, string>();
  for (const m of memberships ?? []) roleByOrg.set(m.organization_id, m.role);
  if (roleByOrg.size === 0) return null;

  const [{ data: stores }, { data: assignments }] = await Promise.all([
    supabase.from("salon_stores").select("*").order("store_name", { ascending: true }),
    supabase.from("store_members").select("store_id").eq("user_id", userId),
  ]);
  const assignedStoreIds = new Set((assignments ?? []).map((a) => a.store_id));

  const scoped = (stores ?? []).filter((store) => {
    const role = roleByOrg.get(store.organization_id);
    if (role === "company_owner" || role === "company_admin" || role === "recruiting_admin") return true;
    if (role === "area_manager") return assignedStoreIds.has(store.id);
    return false;
  });
  if (scoped.length === 0) return [];

  const orgIds = [...new Set(scoped.map((s) => s.organization_id))];
  const { data: orgs } = await supabase.from("salon_organizations").select("*").in("id", orgIds);
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id, o.name]));

  return scoped.map((s) => ({
    id: s.id,
    name: s.store_name,
    organizationId: s.organization_id,
    organizationName: orgNameById.get(s.organization_id) ?? null,
  }));
}

const CONCURRENCY = 6;

/**
 * 店舗ごとの採用進捗をまとめて取得する。同時実行数を絞り（店舗数が多い会社でも
 * DBに負荷を集中させない）、取得できなかった店舗は黙って0件にせず failedStores
 * として返す（集計の過小表示を防ぐ）。
 */
export async function loadCompanyHiring(
  stores: CompanyStore[],
): Promise<{ rows: CompanyHiringRow[]; failedStores: CompanyStore[] }> {
  const rows: CompanyHiringRow[] = [];
  const failedStores: CompanyStore[] = [];
  let next = 0;

  async function worker() {
    while (next < stores.length) {
      const store = stores[next++];
      const processes = await getStoreHiringProcesses(store.id);
      if (processes === null) {
        failedStores.push(store);
        continue;
      }
      for (const p of processes) rows.push({ ...p, storeName: store.name });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, stores.length) }, worker));

  rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return { rows, failedStores };
}

export type StatusCounts = Record<string, number>;

export function countByStatus(rows: Array<{ status: string }>): StatusCounts {
  const counts: StatusCounts = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
}

/** 進行中（連絡調整中〜内定）の件数。採用・辞退・不採用は含めない。 */
export function activeCount(counts: StatusCounts): number {
  return ["contacting", "interview_scheduled", "interview_completed", "selection", "offered"].reduce(
    (sum, s) => sum + (counts[s] ?? 0),
    0,
  );
}
