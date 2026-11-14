import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlatformAdmin } from "@/lib/admin/is-admin";
import { REGION_PREFECTURES, isRegionBlock, isPrefecture, type RegionBlock } from "@/lib/admin/regions";

/**
 * 運営の「会社・店舗」「美容師」一覧・詳細のデータ取得（読み取り専用）。
 * ★権限は二重: ここで is_platform_admin() を確認し、さらにDBの admin_* 関数が先頭で同じ確認をする（0060草案）。
 * ★取得に失敗した場合は 0件 ではなく ok:false を返し、画面は「取得できませんでした」と表示する。
 */
type Supa = Pick<SupabaseClient, "rpc">;
export const PAGE_SIZE = 30;

export type DirectoryResult<T> = { ok: true; data: T } | { ok: false; reason: "forbidden" | "error" | "not_found" };

async function call<T>(supabase: Supa, fn: string, args: Record<string, unknown>): Promise<DirectoryResult<T>> {
  if (!(await isPlatformAdmin(supabase))) return { ok: false, reason: "forbidden" };
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      const m = String(error.message ?? "");
      if (m.includes("admin access required")) return { ok: false, reason: "forbidden" };
      if (m.includes("not found")) return { ok: false, reason: "not_found" };
      return { ok: false, reason: "error" };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export type Person = { user_id: string; role: string; name: string | null; email: string; since?: string };
export type OrgRow = {
  id: string; name: string; status: string; created_at: string; store_count: number;
  stores: { id: string; name: string; prefecture: string | null; city: string | null; visibility: string | null; usage_status: string }[];
  members: Person[];
};
export type OrgDetail = {
  organization: { id: string; name: string; status: string; created_at: string };
  stores: { id: string; name: string; status: string; usage_status: string; visibility: string | null; prefecture: string | null; city: string | null; address_source: "profile" | "store" | null; members: Person[] }[];
  members: Person[];
  hiring_process_count: number;
};
export type StylistRow = {
  user_id: string; public_name: string | null; full_name: string | null; email: string; visibility: string;
  residence_prefecture: string | null; desired_work_location: string | null; experience_years: number | null;
  job_change_intent: string | null; created_at: string; diagnosis_type: string | null;
};
export type StylistDetail = StylistRow & {
  updated_at: string; current_position: string | null; specialties: string[]; employment_type: string | null; bio: string | null;
  diagnosis: { type_id: string; type_name: string; diagnosed_at: string } | null;
  preference_status: string | null; evidence: Record<string, number>;
  hiring_processes: { id: string; store_id: string; store_name: string; organization_name: string; status: string; source: string; updated_at: string }[];
};

type Sp = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** 絞り込み指定（URLの検索条件）。都道府県の指定が優先、無ければ地域ブロックを都道府県へ展開する。 */
export type AreaFilter = { prefectures: string[] | null; includeUnset: boolean; region: RegionBlock | ""; prefecture: string };
export function parseArea(sp: Sp, prefKey = "pref", regionKey = "region"): AreaFilter {
  const pref = one(sp[prefKey]);
  const region = one(sp[regionKey]);
  if (pref === "unset") return { prefectures: null, includeUnset: true, region: "", prefecture: "unset" };
  if (isPrefecture(pref)) return { prefectures: [pref], includeUnset: false, region: "", prefecture: pref };
  if (isRegionBlock(region)) return { prefectures: [...REGION_PREFECTURES[region]], includeUnset: false, region, prefecture: "" };
  return { prefectures: null, includeUnset: false, region: "", prefecture: "" };
}
export function parsePage(sp: Sp): number {
  const n = Number.parseInt(one(sp.page), 10);
  return Number.isFinite(n) && n >= 1 && n <= 1000 ? n : 1;
}
export const parseQ = (sp: Sp) => one(sp.q).trim().slice(0, 100);

export function listOrganizations(supabase: Supa, a: { q: string; area: AreaFilter; visibility: string; usage: string; page: number }) {
  return call<{ total: number; rows: OrgRow[] }>(supabase, "admin_list_organizations", {
    p_q: a.q || null, p_prefectures: a.area.prefectures, p_include_unset: a.area.includeUnset,
    p_visibility: a.visibility === "PUBLIC" || a.visibility === "PRIVATE" ? a.visibility : null,
    p_usage: a.usage === "active" || a.usage === "inactive" ? a.usage : null,
    p_limit: PAGE_SIZE, p_offset: (a.page - 1) * PAGE_SIZE,
  });
}
export function getOrganization(supabase: Supa, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Promise.resolve<DirectoryResult<OrgDetail>>({ ok: false, reason: "not_found" });
  return call<OrgDetail>(supabase, "admin_get_organization", { p_organization_id: id });
}
export function listStylists(supabase: Supa, a: { q: string; residence: AreaFilter; desired: AreaFilter; visibility: string; page: number }) {
  return call<{ total: number; rows: StylistRow[] }>(supabase, "admin_list_stylists", {
    p_q: a.q || null, p_residence_prefectures: a.residence.prefectures, p_residence_unset: a.residence.includeUnset,
    p_desired_prefectures: a.desired.prefectures,
    p_visibility: a.visibility === "PUBLIC" || a.visibility === "PRIVATE" ? a.visibility : null,
    p_limit: PAGE_SIZE, p_offset: (a.page - 1) * PAGE_SIZE,
  });
}
export function getStylist(supabase: Supa, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Promise.resolve<DirectoryResult<StylistDetail>>({ ok: false, reason: "not_found" });
  return call<StylistDetail>(supabase, "admin_get_stylist", { p_user_id: id });
}
