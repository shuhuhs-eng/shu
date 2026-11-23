import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAdminOperator } from "@/lib/admin/operator";
import { isMissingFunctionError, type OpsResult } from "@/lib/admin/operations";
import {
  VISIT_ENTRANCES, VISIT_KINDS, VISIT_LIST_STATUSES, isVisitList, isVisitDetail,
  type VisitList, type VisitDetail,
} from "@/lib/admin/visit-requests-shared";

/**
 * 運営: 見学・体験入店の受付（0087 草案）の読み取り。権限は二重（ここ＋DB側RPC）。
 * 取得失敗は0件にせず ok:false。RPC未適用は reason:"unavailable"（正常な0件と区別）。
 * ★請求・決済・スカウト消費には一切触れない。連絡は既存の連絡機能へのリンクのみ。
 */
type Supa = Pick<SupabaseClient, "rpc">;
export const VISIT_PAGE_SIZE = 30;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
type Sp = Record<string, string | string[] | undefined>;

export function parseVisitFilters(sp: Sp) {
  const entrance = one(sp.entrance), kind = one(sp.kind), status = one(sp.status);
  return {
    entrance: (VISIT_ENTRANCES as readonly string[]).includes(entrance) ? entrance : "",
    kind: (VISIT_KINDS as readonly string[]).includes(kind) ? kind : "",
    status: (VISIT_LIST_STATUSES as readonly string[]).includes(status) ? status : "",
    legacy: one(sp.legacy) === "1",
  };
}

async function call<T>(supabase: Supa, fn: string, args: Record<string, unknown>, validate: (d: unknown) => d is T): Promise<OpsResult<T>> {
  if (!(await isAdminOperator(supabase))) return { ok: false, reason: "forbidden" };
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      if (String(error.message ?? "").includes("admin access required")) return { ok: false, reason: "forbidden" };
      if (isMissingFunctionError(error)) return { ok: false, reason: "unavailable" };
      return { ok: false, reason: "error" };
    }
    return validate(data) ? { ok: true, data } : { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export function listVisitRequests(supabase: Supa, a: { entrance: string; kind: string; status: string; legacy: boolean; page: number }) {
  return call<VisitList>(supabase, "admin_list_visit_requests", {
    p_entrance: a.entrance || null, p_kind: a.kind || null, p_status: a.status || null, p_assignee: null,
    p_include_legacy: a.legacy, p_limit: VISIT_PAGE_SIZE, p_offset: (a.page - 1) * VISIT_PAGE_SIZE,
  }, isVisitList);
}
export function getVisitRequest(supabase: Supa, id: string) {
  return call<VisitDetail>(supabase, "admin_get_visit_request", { p_id: id }, isVisitDetail);
}

/** ダッシュボード用: 状態ごとの件数（取得できないときは null。0件とは区別する）。 */
export async function countVisitRequestsByStatus(supabase: Supa, status: string): Promise<number | null> {
  const r = await call<VisitList>(supabase, "admin_list_visit_requests", {
    p_entrance: null, p_kind: null, p_status: status, p_assignee: null, p_include_legacy: false, p_limit: 1, p_offset: 0,
  }, isVisitList);
  return r.ok ? r.data.total : null;
}
