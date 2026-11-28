/**
 * 地域検索 v2 のアプリ側の契約層（DB草案 area_search_v2.draft.sql に対応。DB適用前は呼び出さない）。
 *  - RPCの入出力の型、エラー文言の対応、画面に出す文言、ページ送りの状態管理だけを持つ。
 *  - 並び・地域判定・相性はDBが決める。ここでは並べ替えない（カーソルが条件に結び付くため）。
 */
export type SearchMode = "near" | "all" | "manual";
export type AreaBadge = "area_match" | "same_pref" | "near_pref" | "nationwide" | "unconfirmed" | "manual_match" | null;
export type AreaSlot = "main" | "unconfirmed";

export const AREA_BADGE_LABEL: Record<Exclude<AreaBadge, null>, string> = {
  area_match: "希望勤務地と一致",
  same_pref: "同じ都道府県で希望",
  near_pref: "近隣の都道府県で希望",
  nationwide: "全国で検討可",
  unconfirmed: "詳細未確認",
  manual_match: "選択した地域に合致",
};

export type ScoutCandidatesPage<T = Record<string, unknown>> = {
  items: (T & { area_badge: AreaBadge; area_slot: AreaSlot; sort_score: number })[];
  next_cursor: string | null;
  mode: SearchMode;
  counts: { main: number; unconfirmed: number; total: number };
  store_region: { status: "confirmed" | "unconfirmed" | "stale"; pref_code: string | null; city_code: string | null; ward_code: string | null };
  active_version: string;
};

/** DBの例外メッセージ → 利用者向けの文言（原因を断定しすぎない）。 */
export function areaErrorMessage(message: string | undefined | null): string {
  const m = message ?? "";
  if (m.includes("area_preference_revision_conflict")) return "別の画面で希望勤務地が更新されました。最新の内容を読み込み直してから、もう一度保存してください。";
  if (m.includes("store_region_revision_conflict")) return "別の担当者が所在地を更新しました。最新の内容を読み込み直してから、もう一度確定してください。";
  if (m.includes("address_changed")) return "店舗の住所が変更されました。住所を確認してから、所在地の確定をやり直してください。";
  if (m.includes("insufficient permission")) return "この操作には、採用管理の権限が必要です。";
  if (m.includes("ward_required")) return "政令指定都市は、区まで選択してください。";
  if (m.includes("city_mismatch") || m.includes("ward_not_allowed")) return "選択した市区が、店舗の都道府県と一致しないか、現在は選択できません。";
  if (m.includes("overlapping_codes")) return "都道府県と市区など、含み合う地域は同時に選べません。どちらか一方を選んでください。";
  if (m.includes("unknown_or_expired_code")) return "選択した地域が見つかりません。画面を読み込み直してください。";
  if (m.includes("too_many_codes")) return "選択できる地域の数を超えています。";
  if (m.includes("selected_requires_codes")) return "地域を1つ以上選ぶか、『全国どこでも可』『未設定』を選んでください。";
  if (m.includes("invalid_cursor")) return "条件が変わったため、一覧を最初から読み込み直しました。";
  if (m.includes("region_master_not_active")) return "地域検索は現在ご利用いただけません。";
  return "処理を完了できませんでした。時間をおいて、もう一度お試しください。";
}

/** 近隣モードで対象が0件のときの文言（『美容師がいない』とは言わない。D3）。 */
export function nearEmptyMessage(): string {
  return "この店舗の近隣を希望する美容師は、まだ見つかっていません。『全国』から探すこともできます。希望勤務地を設定していない美容師は、近隣には表示されません。";
}

/** ページ送りの状態。条件(モード・地域)が変わったらカーソルを捨てる（DBも条件不一致を拒否する）。 */
export type PagerState<T> = { conditionKey: string; items: T[]; nextCursor: string | null; exhausted: boolean };
export const conditionKey = (storeId: string, mode: SearchMode, codes: readonly string[] = []) => [storeId, mode, [...codes].sort().join(",")].join("|");
export function emptyPager<T>(key: string): PagerState<T> { return { conditionKey: key, items: [], nextCursor: null, exhausted: false }; }
export function appendPage<T extends { stylist_user_id?: string; store_id?: string }>(state: PagerState<T>, key: string, page: { items: T[]; next_cursor: string | null }): PagerState<T> {
  if (key !== state.conditionKey) return { conditionKey: key, items: [...page.items], nextCursor: page.next_cursor, exhausted: !page.next_cursor };
  const seen = new Set(state.items.map((i) => i.stylist_user_id ?? i.store_id));
  const add = page.items.filter((i) => !seen.has(i.stylist_user_id ?? i.store_id));
  return { conditionKey: key, items: [...state.items, ...add], nextCursor: page.next_cursor, exhausted: !page.next_cursor };
}

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }> };
export async function fetchScoutCandidatesV2(
  supabase: unknown, args: { storeId: string; mode: SearchMode; regionCodes?: string[]; limit?: number; cursor?: string | null },
): Promise<{ ok: true; page: ScoutCandidatesPage } | { ok: false; message: string }> {
  const { data, error } = await (supabase as RpcClient).rpc("get_scout_candidates_v2", {
    p_store_id: args.storeId, p_mode: args.mode, p_region_codes: args.mode === "manual" ? args.regionCodes ?? [] : null, p_limit: args.limit ?? 20, p_cursor: args.cursor ?? null,
  });
  if (error || !data || typeof data !== "object" || !Array.isArray((data as { items?: unknown }).items)) return { ok: false, message: areaErrorMessage(error?.message) };
  return { ok: true, page: data as ScoutCandidatesPage };
}

/** 所在地の確定: 画面を開いた時点の住所の指紋(address_fingerprint)と所在地リビジョン(region_revision。未登録は0)を必ず送る。 */
export type StoreRegionState = { status: "confirmed" | "unconfirmed" | "stale" | "expired"; address_fingerprint: string; region_revision: number; pref_code: string | null; city_code: string | null; ward_code: string | null };
export async function confirmStoreRegion(
  supabase: unknown, args: { storeId: string; cityCode: string; wardCode?: string | null; expectedFingerprint: string; expectedRevision: number },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await (supabase as RpcClient).rpc("confirm_store_region", {
    p_store_id: args.storeId, p_city_code: args.cityCode, p_ward_code: args.wardCode ?? null,
    p_expected_fingerprint: args.expectedFingerprint, p_expected_revision: args.expectedRevision,
  });
  return error ? { ok: false, message: areaErrorMessage(error.message) } : { ok: true };
}

/** 美容師側: 店舗一覧 v2（get_public_stores_for_stylist_v2）。 */
export type StoresPage<T = Record<string, unknown>> = {
  items: (T & { area_badge: AreaBadge; area_slot: AreaSlot; sort_score: number })[];
  next_cursor: string | null; mode: SearchMode; my_area_mode: "unset" | "selected" | "nationwide";
  counts: { main: number; unconfirmed: number; total: number }; active_version: string;
};
export async function fetchStoresForStylistV2(
  supabase: unknown, args: { mode: SearchMode; regionCodes?: string[]; limit?: number; cursor?: string | null },
): Promise<{ ok: true; page: StoresPage } | { ok: false; message: string }> {
  const { data, error } = await (supabase as RpcClient).rpc("get_public_stores_for_stylist_v2", {
    p_mode: args.mode, p_region_codes: args.mode === "manual" ? args.regionCodes ?? [] : null, p_limit: args.limit ?? 20, p_cursor: args.cursor ?? null,
  });
  if (error || !data || typeof data !== "object" || !Array.isArray((data as { items?: unknown }).items)) return { ok: false, message: areaErrorMessage(error?.message) };
  return { ok: true, page: data as StoresPage };
}

/** 美容師の希望勤務地（本人のみ）。 */
export type MyAreaPreference = {
  mode: "unset" | "selected" | "nationwide"; revision: number; master_version: string | null; active_version: string | null; needs_review: boolean | null;
  items: { code: string; level: "pref" | "city" | "ward"; name: string; pref_code: string; parent_code: string | null; needs_review: boolean }[];
};
export async function fetchMyAreaPreference(supabase: unknown): Promise<{ ok: true; pref: MyAreaPreference } | { ok: false; message: string }> {
  const { data, error } = await (supabase as RpcClient).rpc("get_my_area_preference", {});
  if (error || !data || typeof data !== "object" || !Array.isArray((data as { items?: unknown }).items)) return { ok: false, message: areaErrorMessage(error?.message) };
  return { ok: true, pref: data as MyAreaPreference };
}
export async function saveMyAreaPreference(
  supabase: unknown, args: { mode: "unset" | "selected" | "nationwide"; codes: string[]; expectedRevision: number },
): Promise<{ ok: true; revision: number } | { ok: false; message: string; conflict: boolean }> {
  const { data, error } = await (supabase as RpcClient).rpc("save_stylist_area_preference", {
    p_mode: args.mode, p_codes: args.mode === "selected" ? args.codes : [], p_expected_revision: args.expectedRevision,
  });
  if (error) return { ok: false, message: areaErrorMessage(error.message), conflict: (error.message ?? "").includes("area_preference_revision_conflict") };
  const rev = (data as { revision?: unknown } | null)?.revision;
  return typeof rev === "number" ? { ok: true, revision: rev } : { ok: false, message: areaErrorMessage(null), conflict: false };
}

/** 店舗の所在地の取得（get_store_region）。 */
export type StoreRegionView = StoreRegionState & { store_id: string; active_version: string; address: { prefecture: string | null; city: string | null; street_address: string | null }; city_name: string | null; ward_name: string | null };
export async function fetchStoreRegion(supabase: unknown, storeId: string): Promise<{ ok: true; region: StoreRegionView | null } | { ok: false; message: string }> {
  const { data, error } = await (supabase as RpcClient).rpc("get_store_region", { p_store_id: storeId });
  if (error) return { ok: false, message: areaErrorMessage(error.message) };
  return { ok: true, region: (data as StoreRegionView | null) ?? null };
}

/** 検索結果の items[].match（相性）を、既存カードが受け取る形に整える。想定外の形は「計算できない」として扱う。 */
export type MatchLike = { available: true; overall_score: number; axis_scores: Record<string, number> } | { available: false; reason: string };
export function toMatchResult(m: unknown): MatchLike | null {
  if (!m || typeof m !== "object") return null;
  const o = m as { available?: unknown; overall_score?: unknown; axis_scores?: unknown; reason?: unknown };
  if (o.available === true && typeof o.overall_score === "number" && o.axis_scores && typeof o.axis_scores === "object") return { available: true, overall_score: o.overall_score, axis_scores: o.axis_scores as Record<string, number> };
  return { available: false, reason: typeof o.reason === "string" ? o.reason : "unknown" };
}
