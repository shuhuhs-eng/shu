import type { TraitScores, TraitKey } from "./traits";

/**
 * Beauty Reach 8タイプ（front-facing称号）。
 * 既存の12タイプ（内部詳細レイヤー）は置き換えない。この8タイプは
 * ユーザーへ前面表示する称号としてのみ利用する（12.1節・requirements-v1.0.md参照）。
 */
export const CORE_TYPE_CODES = [
  "shimei_jishaku",
  "aisare_ace",
  "niaiwase_master",
  "trend_maker",
  "iyashi_charisma",
  "repeat_king",
  "mirai_no_ace",
  "brand_builder",
] as const;

export type CoreTypeCode = (typeof CORE_TYPE_CODES)[number];

/**
 * 各タイプの6才能への重み配分（合計1.0）。
 *
 * ★重要: この重みは supabase/migrations/0004_core_types.sql の
 * save_core_type_result() RPC内のSQLと完全に一致させること。
 * 実際にDBへ保存される値はRPC側が診断結果の生スコアから独自に再計算した
 * ものであり（クライアント入力は信用しない設計）、このTS版は
 * テスト・将来のプレビュー用途のための同一ロジックの複製である。
 * 変更する場合は必ず両方を同時に更新し、パリティテスト
 * （scripts/verify-core-types.mts 相当）で一致を確認すること。
 */
export const CORE_TYPE_WEIGHTS: Record<CoreTypeCode, TraitScores> = {
  shimei_jishaku:  { T: 0.20, S: 0.00, H: 0.50, B: 0.30, A: 0.00, M: 0.00 },
  aisare_ace:      { T: 0.35, S: 0.00, H: 0.45, B: 0.00, A: 0.00, M: 0.20 },
  niaiwase_master: { T: 0.50, S: 0.35, H: 0.15, B: 0.00, A: 0.00, M: 0.00 },
  trend_maker:     { T: 0.00, S: 0.50, H: 0.00, B: 0.35, A: 0.15, M: 0.00 },
  iyashi_charisma: { T: 0.00, S: 0.20, H: 0.50, B: 0.00, A: 0.00, M: 0.30 },
  repeat_king:     { T: 0.35, S: 0.00, H: 0.40, B: 0.00, A: 0.25, M: 0.00 },
  mirai_no_ace:    { T: 0.30, S: 0.00, H: 0.00, B: 0.20, A: 0.50, M: 0.00 },
  brand_builder:   { T: 0.00, S: 0.00, H: 0.00, B: 0.45, A: 0.20, M: 0.35 },
};

export type CoreTypeClassification = {
  topType: CoreTypeCode;
  secondType: CoreTypeCode;
  /** 1位と2位のmatchScoreの差。将来の確信度・安定性判定の元データ。 */
  scoreGap: number;
  /** 全8タイプ分の生matchScore。将来の閾値調整・安定性判定に使う。 */
  matchScores: Record<CoreTypeCode, number>;
};

const TRAIT_KEYS: TraitKey[] = ["T", "S", "H", "B", "A", "M"];

/**
 * 重みを「100分の1」の整数にしたもの（0.35 → 35）。浮動小数点の誤差を避けるため、計算は整数で行う。
 * ★SQL（save_core_type_result）は numeric（10進数の厳密計算）で `round(重み×スコアの合計, 1)` を求める。
 *   TSで `Math.round(浮動小数点の合計 × 10) / 10` と書くと、0.05刻みの境界（例: 29.95）で、TSは29.9・SQLは30.0
 *   のように0.1ずれることがある（ローカルDBでの実測: 4,000通り×8タイプのうち約3%）。ずれるとプレビューと保存結果で
 *   1位・2位が食い違い得るため、整数で計算して SQL の「四捨五入（0.05は切り上げ）」と一致させる。
 */
const WEIGHT_HUNDREDTHS: Record<CoreTypeCode, Record<TraitKey, number>> = Object.fromEntries(
  CORE_TYPE_CODES.map((code) => [
    code,
    Object.fromEntries(TRAIT_KEYS.map((k) => [k, Math.round(CORE_TYPE_WEIGHTS[code][k] * 100)])),
  ]),
) as Record<CoreTypeCode, Record<TraitKey, number>>;

/**
 * 6才能スコア（0〜100の整数）から8タイプの matchScore を算出し、1位・2位・差・全件を返す。
 * 単純な最大値1項目ではなく、6スコアの加重和（複数スコアの組み合わせ）で決まる。
 *
 * 並べ替え: 得点の降順。**同点のときは CORE_TYPE_CODES の定義順**（1位・2位とも同じ規則）。
 * DB側（0078 の save_core_type_result）も同じ規則。乱数や微小な加点で同点を隠さない。
 *
 * ★このTS関数はDBへ何も書き込まない（読み取り専用の計算）。実際にDBへ
 * 保存する際の真のトラスト境界は save_core_type_result() RPC（SQL側で
 * 診断結果の生スコアから独自に再計算する）であり、クライアントから
 * この関数の戻り値をそのままRPCへ渡しても、RPCはその値を信用しない。
 */
export function calculateCoreType(scores: TraitScores): CoreTypeClassification {
  const tenths = {} as Record<CoreTypeCode, number>;
  const matchScores = {} as Record<CoreTypeCode, number>;

  for (const code of CORE_TYPE_CODES) {
    const w = WEIGHT_HUNDREDTHS[code];
    // 合計は「100分の1」単位の整数。0.1単位への四捨五入（5は切り上げ）＝ floor((合計 + 5) / 10)。スコアは0以上。
    const hundredths = TRAIT_KEYS.reduce((sum, k) => sum + w[k] * scores[k], 0);
    tenths[code] = Math.floor((hundredths + 5) / 10);
    matchScores[code] = tenths[code] / 10;
  }

  const ranked = CORE_TYPE_CODES.map((code, order) => ({ code, tenths: tenths[code], order })).sort(
    (a, b) => b.tenths - a.tenths || a.order - b.order,
  );

  return {
    topType: ranked[0].code,
    secondType: ranked[1].code,
    scoreGap: (ranked[0].tenths - ranked[1].tenths) / 10,
    matchScores,
  };
}
