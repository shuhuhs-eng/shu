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
import { PAGE_SIZE, one, parsePage } from "@/lib/admin/page-params";
export { PAGE_SIZE, parsePage };

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

export type { Person, OrgRow, OrgDetail, RegistrationState, SalonRegistrant, StylistRow, StylistDetail } from "@/lib/admin/directory-types";
import { REGISTRATION_STATES } from "@/lib/admin/directory-types";
import type { Person, OrgRow, OrgDetail, RegistrationState, SalonRegistrant, StylistRow, StylistDetail } from "@/lib/admin/directory-types";
export { REGISTRATION_STATES };
type Sp = Record<string, string | string[] | undefined>;

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
export function listStylists(supabase: Supa, a: { q: string; residence: AreaFilter; desired: AreaFilter; visibility: string; state?: string; page: number }) {
  return call<{ total: number; rows: StylistRow[] }>(supabase, "admin_list_stylists", {
    p_q: a.q || null, p_residence_prefectures: a.residence.prefectures, p_residence_unset: a.residence.includeUnset,
    p_desired_prefectures: a.desired.prefectures,
    p_visibility: a.visibility === "PUBLIC" || a.visibility === "PRIVATE" ? a.visibility : null,
    p_state: (REGISTRATION_STATES as string[]).includes(a.state ?? "") ? a.state : null,
    p_limit: PAGE_SIZE, p_offset: (a.page - 1) * PAGE_SIZE,
  });
}
/** 会社が作られていないサロン登録者（登録途中を含む）。 */
export function listSalonRegistrants(supabase: Supa, page: number) {
  return call<{ total: number; rows: SalonRegistrant[] }>(supabase, "admin_list_salon_registrants_without_company", { p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE });
}
export function getStylist(supabase: Supa, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Promise.resolve<DirectoryResult<StylistDetail>>({ ok: false, reason: "not_found" });
  return call<StylistDetail>(supabase, "admin_get_stylist", { p_user_id: id });
}
