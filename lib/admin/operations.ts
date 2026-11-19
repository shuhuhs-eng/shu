import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlatformAdmin } from "@/lib/admin/is-admin";

/**
 * 運営の「面接・採用の進捗」「話を聞いてみたい（関心）」「サロンらしさ診断の不足」の一覧（読み取り専用）。
 * DB側は 0085（草案）の admin_list_* 3つのRPC。
 * ★権限は二重: ここで is_platform_admin() を確認し、DB側のRPCも先頭で同じ確認をする。
 * ★取得に失敗したとき（RPCの不在・エラー・想定外の戻り値）は 0件 にしない。ok:false を返し、画面は「取得できませんでした」と表示する。
 *   RPC が未適用（関数が無い）ときは reason:"unavailable" で、正常な 0件 とは区別して表示する。
 * ★連絡の送信はしない。連絡は既存の /admin/messages/new へのリンクだけを用意する。
 */
type Supa = Pick<SupabaseClient, "rpc">;
export const OPS_PAGE_SIZE = 30;

export type OpsFailure = "forbidden" | "unavailable" | "error";
export type OpsResult<T> = { ok: true; data: T } | { ok: false; reason: OpsFailure };

/** 関数が存在しないことを示すエラーか（PostgREST の PGRST202／Postgres の 42883）。 */
export function isMissingFunctionError(e: { code?: unknown; message?: unknown } | null | undefined): boolean {
  if (!e) return false;
  const code = String(e.code ?? "");
  const m = String(e.message ?? "");
  return code === "PGRST202" || code === "42883" || /could not find the function/i.test(m) || /function .* does not exist/i.test(m);
}

async function call<T>(supabase: Supa, fn: string, args: Record<string, unknown>, validate: (d: unknown) => d is T): Promise<OpsResult<T>> {
  if (!(await isPlatformAdmin(supabase))) return { ok: false, reason: "forbidden" };
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      if (String(error.message ?? "").includes("admin access required")) return { ok: false, reason: "forbidden" };
      if (isMissingFunctionError(error)) return { ok: false, reason: "unavailable" };
      return { ok: false, reason: "error" };
    }
    // 戻り値が想定の形でなければ、空の一覧とは見なさず取得失敗にする。
    return validate(data) ? { ok: true, data } : { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

// ---------- 型 ----------
export type HiringView = "all" | "interview_scheduled" | "interview_elapsed_not_updated";
export const HIRING_VIEWS: HiringView[] = ["interview_scheduled", "interview_elapsed_not_updated", "all"];
export const HIRING_STATUSES = ["contacting", "interview_scheduled", "interview_completed", "selection", "offered", "hired", "declined", "rejected"] as const;

export type HiringRow = {
  process_id: string; status: string; source: string;
  store_id: string; store_name: string; organization_id: string; organization_name: string;
  stylist_user_id: string; stylist_public_name: string | null; stylist_full_name: string | null;
  interview_at: string | null; interview_type: string | null; interview_location: string | null;
  interview_elapsed_not_updated: boolean;
  created_at: string; updated_at: string; hired_at: string | null; closed_at: string | null; last_event_at: string | null;
};
export type HiringList = { as_of: string; total: number; rows: HiringRow[] };

export type InterestProgress = "not_created" | "created";
export type InterestRow = {
  interest_id: string; created_at: string;
  stylist_user_id: string; stylist_public_name: string | null; stylist_full_name: string | null;
  store_id: string; store_name: string; organization_id: string; organization_name: string;
  progress_state: InterestProgress; process_id: string | null; process_status: string | null; process_source: string | null;
};
export type InterestList = { as_of: string; total: number; legacy_rows_without_store: number; rows: InterestRow[] };

export type CultureState = "no_culture_row" | "not_completed" | "completed_match_unready" | "completed_type_unready" | "ready";
export const CULTURE_STATES: CultureState[] = ["no_culture_row", "not_completed", "completed_match_unready", "completed_type_unready", "ready"];
export type AxisProblems = {
  axes_state: "sql_null" | "json_null" | "not_object" | "object";
  absent_keys: string[]; json_null_keys: string[]; wrong_type_keys: string[]; out_of_range_keys: string[]; unusable_keys: string[];
};
export type CultureRow = {
  store_id: string; store_name: string; organization_id: string; organization_name: string; visibility: string;
  culture_row_exists: boolean; culture_status: string | null; culture_updated_at: string | null; state: CultureState;
  match_axes: AxisProblems; type_axes: AxisProblems;
};
export type CultureSummary = { stores: number; no_culture_row: number; not_completed: number; completed_match_unready: number; completed_type_unready: number; ready: number };
export type CultureList = { as_of: string; total: number; summary: CultureSummary; rows: CultureRow[] };

// ---------- 戻り値の検証（想定外の形は取得失敗にする） ----------
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

export function isHiringList(d: unknown): d is HiringList {
  if (!isObj(d) || !isCount(d.total) || !Array.isArray(d.rows)) return false;
  return d.rows.every(
    (r) => isObj(r) && isStr(r.process_id) && isStr(r.status) && isStr(r.store_id) && isStr(r.stylist_user_id) && isStr(r.updated_at) &&
      isStrOrNull(r.interview_at) && typeof r.interview_elapsed_not_updated === "boolean",
  );
}
export function isInterestList(d: unknown): d is InterestList {
  if (!isObj(d) || !isCount(d.total) || !isCount(d.legacy_rows_without_store) || !Array.isArray(d.rows)) return false;
  return d.rows.every(
    (r) => isObj(r) && isStr(r.interest_id) && isStr(r.created_at) && isStr(r.stylist_user_id) && isStr(r.store_id) &&
      (r.progress_state === "not_created" || r.progress_state === "created"),
  );
}
function isAxisProblems(v: unknown): v is AxisProblems {
  return isObj(v) && ["sql_null", "json_null", "not_object", "object"].includes(String(v.axes_state)) &&
    isStrArr(v.absent_keys) && isStrArr(v.json_null_keys) && isStrArr(v.wrong_type_keys) && isStrArr(v.out_of_range_keys) && isStrArr(v.unusable_keys);
}
export function isCultureList(d: unknown): d is CultureList {
  if (!isObj(d) || !isCount(d.total) || !Array.isArray(d.rows) || !isObj(d.summary)) return false;
  const s = d.summary;
  if (![s.stores, s.no_culture_row, s.not_completed, s.completed_match_unready, s.completed_type_unready, s.ready].every(isCount)) return false;
  return d.rows.every(
    (r) => isObj(r) && isStr(r.store_id) && isStr(r.store_name) && CULTURE_STATES.includes(r.state as CultureState) && isAxisProblems(r.match_axes) && isAxisProblems(r.type_axes),
  );
}

// ---------- 検索条件（URL）の解釈 ----------
type Sp = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseOpsPage(sp: Sp): number {
  const n = Number.parseInt(one(sp.page), 10);
  return Number.isFinite(n) && n >= 1 && n <= 1000 ? n : 1;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** YYYY-MM-DD として実在する日付か。 */
export function isValidDateString(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
function addDaysString(s: string, days: number): string {
  const m = DATE_RE.exec(s)!;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return dt.toISOString().slice(0, 10);
}

export type Period = {
  /** 画面の入力（YYYY-MM-DD。日本時間の日付。両端を含む）。不正・未指定は ""。 */
  fromDate: string; toDate: string;
  /** DBに渡す値（from は 00:00 以上、to は翌日 00:00 未満。日本時間）。未指定は null。 */
  from: string | null; to: string | null;
  /** 入力の誤り（開始が終了より後）。true のときはDBを呼ばずに入力の誤りを表示する。 */
  invalid: boolean;
};
/** 期間指定。日付は日本時間（+09:00）の日付として扱い、終了日は含める（翌日0時未満）。 */
export function parsePeriod(sp: Sp): Period {
  const f = one(sp.from).trim(), t = one(sp.to).trim();
  const fromDate = isValidDateString(f) ? f : "";
  const toDate = isValidDateString(t) ? t : "";
  const from = fromDate ? `${fromDate}T00:00:00+09:00` : null;
  const to = toDate ? `${addDaysString(toDate, 1)}T00:00:00+09:00` : null;
  const invalid = fromDate !== "" && toDate !== "" && fromDate > toDate;
  return { fromDate, toDate, from, to, invalid };
}

export function parseHiringView(sp: Sp): HiringView {
  const v = one(sp.view);
  return (HIRING_VIEWS as string[]).includes(v) ? (v as HiringView) : "interview_elapsed_not_updated";
}
export function parseHiringStatus(sp: Sp): string {
  const v = one(sp.status);
  return (HIRING_STATUSES as readonly string[]).includes(v) ? v : "";
}
export function parseInterestProgress(sp: Sp): InterestProgress | "" {
  const v = one(sp.progress);
  return v === "not_created" || v === "created" ? v : "";
}
export function parseCultureState(sp: Sp): CultureState | "" {
  const v = one(sp.state);
  return (CULTURE_STATES as string[]).includes(v) ? (v as CultureState) : "";
}
export function parseCultureVisibility(sp: Sp): "PUBLIC" | "PRIVATE" | "ALL" {
  const v = one(sp.vis);
  return v === "PRIVATE" || v === "ALL" ? v : "PUBLIC";
}

const offsetOf = (page: number) => (page - 1) * OPS_PAGE_SIZE;

// ---------- 取得 ----------
export function listHiringProcesses(supabase: Supa, a: { view: HiringView; status: string; period: Period; page: number }) {
  return call(supabase, "admin_list_hiring_processes", {
    p_view: a.view,
    p_status: a.view === "all" && a.status ? a.status : null,
    p_from: a.period.from, p_to: a.period.to,
    p_organization_id: null, p_store_id: null,
    p_limit: OPS_PAGE_SIZE, p_offset: offsetOf(a.page),
  }, isHiringList);
}

export function listStoreInterests(supabase: Supa, a: { progress: InterestProgress | ""; period: Period; page: number }) {
  return call(supabase, "admin_list_store_interests", {
    p_progress: a.progress || null,
    p_from: a.period.from, p_to: a.period.to,
    p_organization_id: null, p_store_id: null,
    p_limit: OPS_PAGE_SIZE, p_offset: offsetOf(a.page),
  }, isInterestList);
}

export function listCultureReadiness(supabase: Supa, a: { state: CultureState | ""; visibility: "PUBLIC" | "PRIVATE" | "ALL"; page: number }) {
  return call(supabase, "admin_list_store_culture_readiness", {
    p_state: a.state || null,
    p_visibility: a.visibility === "ALL" ? null : a.visibility,
    p_organization_id: null,
    p_limit: OPS_PAGE_SIZE, p_offset: offsetOf(a.page),
  }, isCultureList);
}

/** ダッシュボード用: 件数だけ（1行だけ取得して total を使う）。取得できなければ null（0にしない）。 */
export async function countOperations(supabase: Supa) {
  const [elapsed, interests, culture] = await Promise.all([
    call(supabase, "admin_list_hiring_processes", { p_view: "interview_elapsed_not_updated", p_limit: 1, p_offset: 0 }, isHiringList),
    call(supabase, "admin_list_store_interests", { p_progress: "not_created", p_limit: 1, p_offset: 0 }, isInterestList),
    call(supabase, "admin_list_store_culture_readiness", { p_limit: 1, p_offset: 0 }, isCultureList),
  ]);
  return {
    elapsedNotUpdated: elapsed.ok ? elapsed.data.total : null,
    interestsNotCreated: interests.ok ? interests.data.total : null,
    cultureNotReady: culture.ok ? culture.data.summary.stores - culture.data.summary.ready : null,
  };
}
