import type { SalonCultureAxes } from "@/types/database";

/**
 * 「サロンらしさ」結果画面の表示専用の派生ロジック。
 *
 * ★重要: ここにある関数はすべて「表示のためだけの計算」であり、DBには一切
 * 書き込まない・RPCも呼ばない・診断ロジックにも触れない。入力は既に
 * save_salon_culture_profile() RPCがSQL側で算出しDBへ保存済みの culture_axes
 * のみで、それをUI向けに解釈するレイヤーにすぎない（Sprint1 UIレビュー対応）。
 */

const DEGREE_KEYS = ["education_support", "challenge_openness", "personal_brand_support"] as const;
const DIRECTION_KEYS = ["customer_relationship_style", "management_style"] as const;

/**
 * サロン人格のキャッチネーム。最も特徴が際立っている軸を1つ選び、
 * それに対応するラベルを返す（例:「ブランド育成型サロン」「地域密着型サロン」）。
 * 突出した軸が無い場合は「バランス型サロン」を返す。
 */
export function derivePersonaLabel(axes: SalonCultureAxes): string {
  const candidates: { label: string; score: number }[] = [];

  if (axes.education_support != null) {
    candidates.push({ label: "人材育成型サロン", score: axes.education_support });
  }
  if (axes.challenge_openness != null) {
    candidates.push({ label: "挑戦・革新型サロン", score: axes.challenge_openness });
  }
  if (axes.personal_brand_support != null) {
    candidates.push({ label: "ブランド育成型サロン", score: axes.personal_brand_support });
  }
  if (axes.customer_relationship_style != null) {
    const v = axes.customer_relationship_style;
    candidates.push({ label: "地域密着型サロン", score: v < 50 ? 100 - v : 0 });
    candidates.push({ label: "洗練スタイル型サロン", score: v >= 50 ? v : 0 });
  }
  if (axes.management_style != null) {
    const v = axes.management_style;
    candidates.push({ label: "オーナー直轄型サロン", score: v < 50 ? 100 - v : 0 });
    candidates.push({ label: "チーム自走型サロン", score: v >= 50 ? v : 0 });
  }

  if (candidates.length === 0) return "個性を診断中のサロン";

  const top = candidates.reduce((a, b) => (b.score > a.score ? b : a));
  return top.score >= 65 ? top.label : "バランス型サロン";
}

/** 度合い型軸の値(0-100)から、水準を3段階で判定する。 */
function degreeLevel(value: number): "high" | "mid" | "low" {
  if (value >= 65) return "high";
  if (value >= 40) return "mid";
  return "low";
}

const DEGREE_DESCRIPTIONS: Record<(typeof DEGREE_KEYS)[number], Record<"high" | "mid" | "low", string>> = {
  education_support: {
    high: "若手をじっくり育てる文化",
    mid: "経験を通じて学んでいく文化",
    low: "本人の自主性に任せる文化",
  },
  challenge_openness: {
    high: "新しい挑戦を歓迎する文化",
    mid: "様子を見ながら取り入れる文化",
    low: "積み重ねを大切にする文化",
  },
  personal_brand_support: {
    high: "個人の発信・活躍を後押しする文化",
    mid: "個人とサロンのバランスを取る文化",
    low: "サロン全体としての発信を大切にする文化",
  },
};

const DIRECTION_DESCRIPTIONS: Record<
  (typeof DIRECTION_KEYS)[number],
  { left: string; mid: string; right: string }
> = {
  customer_relationship_style: {
    left: "お客様と家族のように親密に接している",
    mid: "親密さと距離感のバランスを取っている",
    right: "適度な距離感を保ったプロフェッショナルな接客をしている",
  },
  management_style: {
    left: "オーナー・店長が方針をはっきり示している",
    mid: "状況に応じて意思決定の仕方を変えている",
    right: "現場スタッフに裁量を持たせている",
  },
};

/** 6つのらしさ、各項目の一言説明。ドット・バーだけでは伝わらない意味を補う。 */
export function describeAxis(key: string, value: number): string {
  if ((DEGREE_KEYS as readonly string[]).includes(key)) {
    const level = degreeLevel(value);
    return DEGREE_DESCRIPTIONS[key as (typeof DEGREE_KEYS)[number]][level];
  }
  if ((DIRECTION_KEYS as readonly string[]).includes(key)) {
    const desc = DIRECTION_DESCRIPTIONS[key as (typeof DIRECTION_KEYS)[number]];
    if (value < 35) return desc.left;
    if (value > 65) return desc.right;
    return desc.mid;
  }
  return "";
}

/**
 * 「このサロンで活躍しやすい人」の候補を3〜5件導出する。特徴が際立っている
 * 軸から順に該当する説明文を選び、最大5件・最低3件になるよう調整する
 * （閾値を満たす軸が少ない場合は基準を緩めて埋める）。
 */
export function deriveIdealFitDescriptions(axes: SalonCultureAxes): string[] {
  type Candidate = { text: string; strength: number };
  const candidates: Candidate[] = [];

  if (axes.education_support != null) {
    candidates.push({ text: "教育を受けながら着実に成長したい人", strength: axes.education_support });
  }
  if (axes.challenge_openness != null) {
    candidates.push({ text: "新しいことに積極的に挑戦したい人", strength: axes.challenge_openness });
  }
  if (axes.personal_brand_support != null) {
    candidates.push({ text: "個人の発信やブランディングに力を入れたい人", strength: axes.personal_brand_support });
  }
  if (axes.customer_relationship_style != null) {
    const v = axes.customer_relationship_style;
    candidates.push({ text: "お客様と長く深い関係を築きたい人", strength: v < 50 ? 100 - v : 0 });
    candidates.push({ text: "プロフェッショナルな距離感で働きたい人", strength: v >= 50 ? v : 0 });
  }
  if (axes.management_style != null) {
    const v = axes.management_style;
    candidates.push({ text: "明確な方針のもとで安心して働きたい人", strength: v < 50 ? 100 - v : 0 });
    candidates.push({ text: "裁量を持って自分のペースで働きたい人", strength: v >= 50 ? v : 0 });
  }

  const sorted = candidates.filter((c) => c.strength > 0).sort((a, b) => b.strength - a.strength);
  return sorted.slice(0, 5).map((c) => c.text);
}
