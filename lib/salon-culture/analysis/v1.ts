import { SCENES, sceneNaSentence, sceneSentence, type Answer, type SceneKey } from "./scenes";

/**
 * 「サロンらしさ」追加分析 salon-analysis-v1（表示専用の純粋関数）。
 *
 * ★位置づけ（誇張しない）:
 *   - 各軸は「別の場面を問う2つの質問」の回答から作る。2つの回答の平均で段階を決めるだけで、
 *     統計的に検証した指標ではない。社内の設計であり、優劣・能力・成果を示すものではない。
 *   - 性質の違うものは混ぜない（サロン全体の発信と個人の発信、裁量と勤務の柔軟性 等）。
 *   - サロンタイプ（8タイプ）は入力にしない。タイプとこの5軸は、同じ回答から別々に作る
 *     （相互に補正しない）。
 *   - 欠けている・「当てはまらない」の軸は、1や3で埋めない。五角形は5軸が揃ったときだけ描く。
 *   - 旧データから追加5問の回答を推測しない。
 */

export const ANALYSIS_VERSION = "salon-analysis-v1";

export const SUPPLEMENT_KEYS = [
  "q13_nurture_learning_flow",
  "q14_nurture_feedback",
  "q15_brand_staff_presentation",
  "q16_team_handover",
  "q17_discretion_proposal",
] as const;
export type SupplementKey = (typeof SUPPLEMENT_KEYS)[number];

/** 追加回答が参照する既存回答（保存時にサーバーが照合する5つ）。 */
export const BASE_KEYS = [
  "q2_challenge_openness",
  "q3_personal_brand_support",
  "q4_team_collaboration",
  "q5_individual_autonomy",
  "q9_trend_orientation",
] as const;
export type BaseKey = (typeof BASE_KEYS)[number];

export type SupplementValue = Answer | "na";
export type SupplementAnswers = Record<SupplementKey, SupplementValue>;
export type BaseAnswers = Record<BaseKey, Answer>;

/** 既存回答キー → 根拠文用のSceneKey。 */
const BASE_SCENE: Record<BaseKey, SceneKey> = {
  q2_challenge_openness: "challenge_openness",
  q3_personal_brand_support: "personal_brand_support",
  q4_team_collaboration: "team_collaboration",
  q5_individual_autonomy: "individual_autonomy",
  q9_trend_orientation: "trend_orientation",
};

export type AxisId = "nurture" | "novelty" | "personal_brand" | "teamwork" | "discretion";

type SceneRef =
  | { source: "base"; key: BaseKey }
  | { source: "supplement"; key: SupplementKey };

type AxisDef = {
  id: AxisId;
  number: string;
  name: string;
  /** 一言の説明（別概念との区別）。 */
  note: string;
  low: string;
  high: string;
  scenes: [SceneRef, SceneRef];
};

export const ANALYSIS_AXES: readonly AxisDef[] = [
  {
    id: "nurture",
    number: "①",
    name: "育成の進め方",
    note: "育成の流れと、フィードバックの場の整え方を見ます。",
    low: "その都度・担当ごとに育成を進める方針",
    high: "サロンとして流れや場を決めて育成する方針",
    scenes: [
      { source: "supplement", key: "q13_nurture_learning_flow" },
      { source: "supplement", key: "q14_nurture_feedback" },
    ],
  },
  {
    id: "novelty",
    number: "②",
    name: "新しいことの取り入れ方",
    note: "スタッフの提案への対応と、新しい技術・スタイルへの動き方を見ます。",
    low: "実績や定着を確認してから取り入れる方針",
    high: "早い段階から試して取り入れる方針",
    scenes: [
      { source: "base", key: "q2_challenge_openness" },
      { source: "base", key: "q9_trend_orientation" },
    ],
  },
  {
    id: "personal_brand",
    number: "③",
    name: "個人の発信・指名づくり",
    note: "スタッフ個人の発信・指名づくりを見ます。サロン全体の発信（撮影・SNS）とは別の内容で、タイプの根拠で見ます。",
    low: "サロン全体のブランドを中心にする方針",
    high: "スタッフ個人の発信・指名づくりも支える方針",
    scenes: [
      { source: "base", key: "q3_personal_brand_support" },
      { source: "supplement", key: "q15_brand_staff_presentation" },
    ],
  },
  {
    id: "teamwork",
    number: "④",
    name: "仕事上の連携",
    note: "忙しいときの助け合いと、担当者不在時の引き継ぎを見ます。仕事以外の交流は含みません。",
    low: "担当ごとに対応する方針",
    high: "担当を越えて助け合い、引き継ぐ方針",
    scenes: [
      { source: "base", key: "q4_team_collaboration" },
      { source: "supplement", key: "q16_team_handover" },
    ],
  },
  {
    id: "discretion",
    number: "⑤",
    name: "仕事の進め方の裁量",
    note: "日々の進め方と、お客様への提案の決め方を見ます。勤務時間・休みの柔軟性は含みません。連携とは独立して見ます。",
    low: "サロン共通のやり方を基本とする方針",
    high: "基本方針の中で個人の判断を尊重する方針",
    scenes: [
      { source: "base", key: "q5_individual_autonomy" },
      { source: "supplement", key: "q17_discretion_proposal" },
    ],
  },
] as const;

export type Step = 1 | 2 | 3 | 4 | 5;

/**
 * 2つの回答（各1〜5）→ 段階（1〜5）。重み同じの平均で、境界を固定する:
 *   平均<1.8→1 / <2.6→2 / <3.4→3 / <4.2→4 / 4.2以上→5。
 * 2つの合計 s で判定する（整数のみで境界が曖昧にならない）:
 *   s≤3→1, 4〜5→2, 6→3, 7〜8→4, 9〜10→5。
 */
export function pairToStep(a: Answer, b: Answer): Step {
  const s = a + b;
  if (s <= 3) return 1;
  if (s <= 5) return 2;
  if (s <= 6) return 3;
  if (s <= 8) return 4;
  return 5;
}

/** 2つの回答が2以上離れているとき true（「場面によって違いがあります」）。 */
export function scenesDiffer(a: Answer, b: Answer): boolean {
  return Math.abs(a - b) >= 2;
}

const STEP_WORDS: Record<Step, string> = {
  1: "に強く寄っています",
  2: "にやや寄っています",
  3: "どちらにも大きくは寄っていません（中間）",
  4: "にやや寄っています",
  5: "に強く寄っています",
};

/** 段階の説明文。「回答全体ではどちらの方針に寄っているか」。2つとも5という意味ではない。 */
export function stepDescription(def: Pick<AxisDef, "low" | "high">, step: Step): string {
  if (step === 3) return `回答全体では、${STEP_WORDS[3]}。`;
  const side = step <= 2 ? def.low : def.high;
  return `回答全体では、「${side}」${STEP_WORDS[step]}。`;
}

export type SceneResult = {
  source: "base" | "supplement";
  key: BaseKey | SupplementKey;
  /** 1〜5、"na"、未回答は null。 */
  answer: SupplementValue | null;
  sentence: string | null;
};

export type AxisStatus =
  | "determined" // 2つの回答がそろい、段階が出せる
  | "undetermined_na" // 「当てはまらない」を含む
  | "pending" // 追加回答がまだ（または既存回答が使えない）
  | "stale"; // 既存回答が追加回答のあとに変わった

export type AxisResult = {
  id: AxisId;
  number: string;
  name: string;
  note: string;
  low: string;
  high: string;
  status: AxisStatus;
  step: Step | null;
  differ: boolean;
  description: string | null;
  scenes: SceneResult[];
};

export type AnalysisState =
  | "base_none" // サロンらしさ（12問）未回答
  | "base_draft" // 回答途中
  | "base_unusable" // 完了だが追加分析で使う既存回答5つが揃っていない（旧データ等）
  | "need_supplement" // 追加回答が未回答
  | "stale" // 既存回答が追加回答のあとに変わった
  | "partial" // 追加回答あり、「当てはまらない」で5軸が揃わない
  | "ready"; // 5軸がそろった

export type AnalysisResult = {
  state: AnalysisState;
  axes: AxisResult[];
  /** 五角形を描ける（state==="ready" かつ5軸すべて determined）。 */
  drawable: boolean;
};

export type SupplementRow = {
  answers: unknown;
  base_snapshot: unknown;
} | null;

function asAnswer(v: unknown): Answer | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5 ? (v as Answer) : null;
}

/** 既存の回答（answers jsonb）から、追加分析で使う5つを取り出す。1つでも使えなければ null。 */
export function extractBaseAnswers(answers: unknown): BaseAnswers | null {
  if (answers == null || typeof answers !== "object" || Array.isArray(answers)) return null;
  const src = answers as Record<string, unknown>;
  const out: Partial<BaseAnswers> = {};
  for (const k of BASE_KEYS) {
    const v = asAnswer(src[k]);
    if (v == null) return null;
    out[k] = v;
  }
  return out as BaseAnswers;
}

/** 追加回答（jsonb）を検証して取り出す。形式が不正・欠けがあれば null（推測しない）。 */
export function extractSupplementAnswers(answers: unknown): SupplementAnswers | null {
  if (answers == null || typeof answers !== "object" || Array.isArray(answers)) return null;
  const src = answers as Record<string, unknown>;
  const out: Partial<SupplementAnswers> = {};
  for (const k of SUPPLEMENT_KEYS) {
    const raw = src[k];
    if (raw === "na") {
      out[k] = "na";
      continue;
    }
    const v = asAnswer(raw);
    if (v == null) return null;
    out[k] = v;
  }
  return out as SupplementAnswers;
}

function sceneKeyOf(ref: SceneRef): SceneKey {
  return ref.source === "base" ? BASE_SCENE[ref.key] : ref.key;
}

/** 保存時の既存回答（base_snapshot）と現在値の差分。どれか1つでも違えば changed に入る。 */
export function changedBaseKeys(snapshot: unknown, current: BaseAnswers): BaseKey[] {
  const snap = snapshot != null && typeof snapshot === "object" && !Array.isArray(snapshot) ? (snapshot as Record<string, unknown>) : {};
  return BASE_KEYS.filter((k) => snap[k] !== current[k]);
}

export type AnalysisInput = {
  baseStatus: "completed" | "draft" | null;
  /** 既存12問の回答（answers jsonb）。 */
  baseAnswers: unknown;
  supplement: SupplementRow;
};

function buildAxis(
  def: AxisDef,
  base: BaseAnswers,
  supplement: SupplementAnswers | null,
  staleKeys: ReadonlySet<BaseKey>,
): AxisResult {
  const scenes: SceneResult[] = def.scenes.map((ref) => {
    const sk = sceneKeyOf(ref);
    if (ref.source === "base") {
      const a = base[ref.key];
      return { source: "base", key: ref.key, answer: a, sentence: sceneSentence(sk, a) };
    }
    const v = supplement ? supplement[ref.key] : null;
    if (v == null) return { source: "supplement", key: ref.key, answer: null, sentence: null };
    return { source: "supplement", key: ref.key, answer: v, sentence: v === "na" ? sceneNaSentence(sk) : sceneSentence(sk, v) };
  });

  const stale = def.scenes.some((r) => r.source === "base" && staleKeys.has(r.key)) && def.scenes.some((r) => r.source === "supplement");
  const base_result = { id: def.id, number: def.number, name: def.name, note: def.note, low: def.low, high: def.high };

  if (stale) {
    // 追加回答は古い画面の既存回答を前提にしている。現在の既存回答と組み合わせない。
    return { ...base_result, status: "stale", step: null, differ: false, description: null, scenes: scenes.map((s) => (s.source === "supplement" ? { ...s, sentence: null } : s)) };
  }
  const answers = scenes.map((s) => s.answer);
  if (answers.some((a) => a == null)) {
    return { ...base_result, status: "pending", step: null, differ: false, description: null, scenes };
  }
  if (answers.some((a) => a === "na")) {
    return { ...base_result, status: "undetermined_na", step: null, differ: false, description: null, scenes };
  }
  const a = answers[0] as Answer;
  const b = answers[1] as Answer;
  const step = pairToStep(a, b);
  return { ...base_result, status: "determined", step, differ: scenesDiffer(a, b), description: stepDescription(def, step), scenes };
}

/**
 * 状態と5軸をまとめて決める。決定的な純粋関数で、入力以外（他の店舗・ユーザー・キャッシュ）を見ない。
 */
export function resolveCultureAnalysis(input: AnalysisInput): AnalysisResult {
  const empty = (state: AnalysisState): AnalysisResult => ({ state, axes: [], drawable: false });
  if (input.baseStatus == null) return empty("base_none");
  if (input.baseStatus === "draft") return empty("base_draft");
  const base = extractBaseAnswers(input.baseAnswers);
  if (!base) return empty("base_unusable");

  const sup = input.supplement ? extractSupplementAnswers(input.supplement.answers) : null;
  // 追加回答の行はあるが中身が不正な場合は、未回答として扱う（推測しない）。
  const changed = input.supplement && sup ? changedBaseKeys(input.supplement.base_snapshot, base) : [];
  const staleKeys = new Set<BaseKey>(changed);
  const axes = ANALYSIS_AXES.map((d) => buildAxis(d, base, sup, staleKeys));

  if (!sup) return { state: "need_supplement", axes, drawable: false };
  if (changed.length > 0) return { state: "stale", axes, drawable: false };
  const drawable = axes.every((a) => a.status === "determined");
  return { state: drawable ? "ready" : "partial", axes, drawable };
}

export function stepToRadiusRatio(step: number): number {
  return step / 5;
}

export { SCENES };
