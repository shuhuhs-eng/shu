import type { SalonCultureAxes } from "@/types/database";

/**
 * 「サロンらしさ」レーダーチャート（5軸）の表示専用ロジック。
 *
 * ★設計方針（読み取り専用の純粋関数。DB書き込み・RPC・診断/マッチング計算には一切触れない）:
 *   - 元データは salon_culture_profiles / salon_store_culture_profiles の culture_axes
 *     （save RPCが「回答1〜5 → (回答-1)×25」で保存済みの値）のみ。
 *   - 5軸は、12軸のうち「1問=1軸」で、集約・平均をせずに表示できるものを選ぶ。
 *     回答の1〜5は 値÷25+1 で厳密に復元できる（捏造・補正・底上げなし）。
 *   - 性質の異なる軸を平均した合成軸は作らない（8タイプの合成軸
 *     autonomy / technical_premium / trend は採用しない）。
 *   - 14問診断（diagnosis_results）の点数は一切使わない。
 *   - 12軸のうち表示しない7軸は、従来どおり「このサロンの特徴」等で表示される。
 *
 * ★選定根拠: サロン8タイプのうち、1軸だけで定義されるタイプは
 *   education / challenge / personal_brand / team / flexibility の5つで、
 *   これが5軸と1対1に対応する（残り3タイプは2軸の平均による合成で、平均しない方針と両立しない）。
 *   5軸は互いに別の領域（育成・挑戦・発信・チーム・働き方）で、意味の重複が少ない。
 *   なお individual_autonomy は team_collaboration の裏返し（autonomy タイプ＝個人判断＋(100-チーム)）
 *   として既存コードが重複を認めているため、5軸には含めない。
 */

export type RadarAxisKey =
  | "education_support"
  | "challenge_openness"
  | "personal_brand_support"
  | "team_collaboration"
  | "work_flexibility";

export type RadarAxisDef = {
  key: RadarAxisKey;
  /** 軸名（スマホでも収まる短い名前）。 */
  name: string;
  /** 段階1（中心側）の方針。診断の質問の左端ラベルに対応。 */
  low: string;
  /** 段階5（外側）の方針。診断の質問の右端ラベルに対応。 */
  high: string;
};

/** 表示順（時計回り、上から）。 */
export const RADAR_AXES: readonly RadarAxisDef[] = [
  {
    key: "education_support",
    name: "育て方",
    low: "本人のペースや自主性を尊重する",
    high: "計画・練習・フォローまでサロンが支援する",
  },
  {
    key: "challenge_openness",
    name: "新しい挑戦",
    low: "実績やリスクを確認し、十分検討してから進める",
    high: "まず挑戦できる方法を一緒に考える",
  },
  {
    key: "personal_brand_support",
    name: "発信・指名",
    low: "サロン全体のブランド・集客を中心にする",
    high: "個人の発信・指名づくりも積極的に支援する",
  },
  {
    key: "team_collaboration",
    name: "チーム",
    low: "各自が自分のお客様・仕事を中心に動く",
    high: "担当を越えて声を掛け合い、助け合う",
  },
  {
    key: "work_flexibility",
    name: "働き方",
    low: "サロンの勤務体系を優先する",
    high: "できるだけ個々の事情や生活に合わせて調整する",
  },
] as const;

/**
 * 保存値（0/25/50/75/100）→ 5段階（1〜5）。
 * 保存値は (回答-1)×25 なので 値÷25+1 で回答そのものに戻る。
 * 範囲外・25の倍数でない値・null/undefined は null（1や3で埋めない）。
 */
export function storedValueToStep(value: number | null | undefined): 1 | 2 | 3 | 4 | 5 | null {
  if (value == null || typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 100 || value % 25 !== 0) return null;
  return (value / 25 + 1) as 1 | 2 | 3 | 4 | 5;
}

export type RadarAxisResult = RadarAxisDef & {
  /** 1〜5。未回答・不正値は null。 */
  step: 1 | 2 | 3 | 4 | 5 | null;
  /** 画面に出す一言（どちらが良いとも言わない）。step が null のときは null。 */
  summary: string | null;
};

export type CultureRadar = {
  axes: RadarAxisResult[];
  /** 5軸すべてが取得できた（チャートを描ける）か。 */
  complete: boolean;
  /** 取得できなかった軸の名前。 */
  missing: string[];
};

function summarize(def: RadarAxisDef, step: 1 | 2 | 3 | 4 | 5): string {
  if (step <= 2) return `${def.low}寄り`;
  if (step >= 4) return `${def.high}寄り`;
  return "どちらか一方に寄らず、中間";
}

/** culture_axes から5軸の段階を作る。欠けている軸は null のまま返し、補完しない。 */
export function deriveCultureRadar(axes: SalonCultureAxes | null | undefined): CultureRadar {
  const src = axes ?? {};
  const results: RadarAxisResult[] = RADAR_AXES.map((def) => {
    const step = storedValueToStep(src[def.key]);
    return { ...def, step, summary: step == null ? null : summarize(def, step) };
  });
  const missing = results.filter((r) => r.step == null).map((r) => r.name);
  return { axes: results, complete: missing.length === 0, missing };
}

/** 段階→半径比。1→0.2 … 5→1.0（線形・補正なし。中心0は「0点」に見えるため使わない）。 */
export function stepToRadiusRatio(step: number): number {
  return step / 5;
}
