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
 * 6才能スコアから8タイプの matchScore を算出し、1位・2位・差・全件を返す。
 * 単純な最大値1項目ではなく、6スコアの加重和（複数スコアの組み合わせ）で決まる。
 *
 * ★このTS関数はDBへ何も書き込まない（読み取り専用の計算）。実際にDBへ
 * 保存する際の真のトラスト境界は save_core_type_result() RPC（SQL側で
 * 診断結果の生スコアから独自に再計算する）であり、クライアントから
 * この関数の戻り値をそのままRPCへ渡しても、RPCはその値を信用しない。
 */
export function calculateCoreType(scores: TraitScores): CoreTypeClassification {
  const matchScores = {} as Record<CoreTypeCode, number>;

  for (const code of CORE_TYPE_CODES) {
    const w = CORE_TYPE_WEIGHTS[code];
    const raw = TRAIT_KEYS.reduce((sum, k) => sum + w[k] * scores[k], 0);
    matchScores[code] = Math.round(raw * 10) / 10;
  }

  const ranked = (Object.entries(matchScores) as [CoreTypeCode, number][]).sort(
    (a, b) => b[1] - a[1],
  );

  return {
    topType: ranked[0][0],
    secondType: ranked[1][0],
    scoreGap: Math.round((ranked[0][1] - ranked[1][1]) * 10) / 10,
    matchScores,
  };
}
