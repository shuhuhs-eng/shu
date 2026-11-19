/**
 * 相性・店舗タイプの「表示できない理由」を、美容師側と店舗側に分けて説明する純粋関数。
 *
 * ★既存の計算式・質問・権限は変更しない。calculate_match_axes_by_store(0031) の戻り値の
 *   reason をそのまま入力にし、画面の文言だけを出し分ける。
 * ★相性は「美容師8軸 × 店舗8軸」、店舗タイプは「店舗12軸」でそれぞれ別に判定する。
 * ★美容師側の情報不足を、店舗側の問題として表示しない。原因を判定できないときは、
 *   どちらの問題とも言わない中立の文言にする。
 */

/** 相性に使う美容師の8軸（stylist_preference_profiles.preference_axes のキー。0010）。 */
export const MATCH_STYLIST_AXIS_KEYS = [
  "education_preference",
  "challenge_preference",
  "personal_brand_preference",
  "collaboration_preference",
  "autonomy_preference",
  "work_flexibility_preference",
  "relationship_distance_preference",
  "hierarchy_preference",
] as const;

/** 相性に使う店舗の8軸（salon_store_culture_profiles.culture_axes のキー。0031）。 */
export const MATCH_STORE_AXIS_KEYS = [
  "education_support",
  "challenge_openness",
  "personal_brand_support",
  "team_collaboration",
  "individual_autonomy",
  "work_flexibility",
  "relationship_distance",
  "hierarchy_flatness",
] as const;

/** 店舗タイプに使う店舗の12軸（lib/salon-culture/salon-culture-types.ts の ALL_TWELVE_AXIS_KEYS と同じ）。 */
export const STORE_TYPE_AXIS_KEYS = [
  "education_support",
  "challenge_openness",
  "personal_brand_support",
  "team_collaboration",
  "individual_autonomy",
  "work_flexibility",
  "technical_specialization",
  "premium_value",
  "trend_orientation",
  "creative_output",
  "relationship_distance",
  "hierarchy_flatness",
] as const;

/** 軸の値として計算に使えるか（0〜100の有限な数値）。null・文字列・NaN・範囲外は使えない。 */
export function isUsableAxisValue(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
}

/** 必要なキーのうち、欠落・null・計算に使えない値のキーを返す（順序は keys の順）。 */
export function findUnusableAxes(axes: unknown, keys: readonly string[]): string[] {
  const obj = axes !== null && typeof axes === "object" && !Array.isArray(axes) ? (axes as Record<string, unknown>) : {};
  return keys.filter((k) => !isUsableAxisValue(obj[k]));
}

/** 相性を表示できない原因（誰の情報が不足しているか）。 */
export type MatchUnavailableCause =
  | "stylist_preference_incomplete" // 美容師の「働きたいサロン環境」が未完了
  | "stylist_axes_incomplete" // 美容師の回答に未回答・使えない値がある
  | "store_culture_incomplete" // 店舗のサロンらしさが未確定
  | "store_axes_incomplete" // 店舗の8軸に欠け・使えない値がある
  | "unknown"; // 判定できない（どちらの問題とも表示しない）

export type MatchUnavailableInput = {
  /** calculate_match_axes_by_store の reason（未知の値・undefined も受け付ける）。 */
  reason: string | null | undefined;
  /**
   * 美容師本人の preference_axes。
   * undefined＝取得していない／取得に失敗（判定に使わない）。null＝行なし。
   */
  stylistAxes?: unknown;
  /** 店舗の culture_axes。undefined＝取得していない（一覧など）。 */
  storeAxes?: unknown;
};

export function classifyMatchUnavailable(input: MatchUnavailableInput): MatchUnavailableCause {
  switch (input.reason) {
    case "stylist_preference_incomplete":
      return "stylist_preference_incomplete";
    case "salon_culture_incomplete":
      return "store_culture_incomplete";
    case "axes_incomplete": {
      // 先に美容師側を確認する。美容師の8軸が使えないなら美容師側の問題。
      if (input.stylistAxes !== undefined) {
        if (findUnusableAxes(input.stylistAxes, MATCH_STYLIST_AXIS_KEYS).length > 0) return "stylist_axes_incomplete";
        // 美容師の8軸が使える → RPC が弾いたのは店舗側。
        return "store_axes_incomplete";
      }
      // 美容師の軸を取得できていない: 店舗の軸だけが分かる場合のみ店舗側と判定。
      if (input.storeAxes !== undefined && findUnusableAxes(input.storeAxes, MATCH_STORE_AXIS_KEYS).length > 0) {
        return "store_axes_incomplete";
      }
      return "unknown";
    }
    default:
      return "unknown";
  }
}

/** 画面に出す文言。美容師側の不足を店舗側の問題とは言わない。 */
export const MATCH_UNAVAILABLE_MESSAGES: Record<MatchUnavailableCause, string> = {
  stylist_preference_incomplete: "働きたいサロン環境を回答すると相性が分かります",
  stylist_axes_incomplete: "働きたいサロン環境の回答に未回答の項目があります。回答を見直すと相性が分かります",
  store_culture_incomplete: "この店舗のサロンらしさは準備中のため、相性はまだ表示できません",
  store_axes_incomplete: "この店舗のサロンらしさの情報が一部不足しているため、相性を表示できません",
  unknown: "相性を表示するための情報が不足しています",
};

/** 美容師自身が対応できる原因か（回答を促す案内を出す対象）。 */
export function isStylistSideCause(cause: MatchUnavailableCause): boolean {
  return cause === "stylist_preference_incomplete" || cause === "stylist_axes_incomplete";
}

export type StoreTypeState =
  | { state: "preparing" } // 店舗のサロンらしさが未確定（culture が無い）
  | { state: "axes_missing"; missing: string[] } // 確定済みだが12軸のうち使えないものがある
  | { state: "ready" };

/** 店舗タイプの表示状態を12軸で判定する（相性の8軸判定とは別）。 */
export function resolveStoreTypeState(culture: { culture_axes?: unknown } | null | undefined): StoreTypeState {
  if (!culture) return { state: "preparing" };
  const missing = findUnusableAxes(culture.culture_axes, STORE_TYPE_AXIS_KEYS);
  return missing.length > 0 ? { state: "axes_missing", missing } : { state: "ready" };
}

export const STORE_TYPE_PREPARING_MESSAGE = "サロンらしさは現在準備中です";
export const STORE_TYPE_AXES_MISSING_MESSAGE = "サロンらしさの情報が一部不足しているため、タイプを表示できません";

/**
 * 店舗側の画面（候補者・興味を持ってくれた美容師）で、相性を表示できないときの文言。
 * 美容師の回答不足を店舗の問題としない。理由が判別できないときはどちらの問題とも言わない。
 */
export function salonSideMatchUnavailableMessage(reason: string | null | undefined): string {
  switch (reason) {
    case "stylist_preference_incomplete":
      return "この美容師が相性に必要な回答を完了すると表示されます";
    case "salon_culture_incomplete":
      return "この店舗のサロンらしさを確定すると表示されます";
    default:
      return "相性に必要な情報が不足しているため表示できません";
  }
}
