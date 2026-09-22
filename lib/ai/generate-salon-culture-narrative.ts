import type { SalonCultureAxes } from "@/types/database";

const MODEL = "claude-sonnet-4-6";
/**
 * ★美容師側の generate-diagnosis-narrative.ts の PROMPT_VERSION（"1.0.0"）
 * とは明確に異なる値にする。diagnosis_ai_outputs.prompt_version で、
 * 美容師AI／旧サロン向け誤生成AI（"1.0.0"のまま）／新サロン専用AIを
 * 区別するための識別子。
 */
const PROMPT_VERSION = "salon-culture-v1";

export type SalonCultureNarrative = {
  essence: string;
  explanation: string;
  advice: string[];
  growth: string;
};

type GenerateInput = {
  /** salon_culture_profiles.culture_axes をそのまま渡す。0/25/50/75/100、12軸。 */
  cultureAxes: SalonCultureAxes;
  /** salon_culture_profiles.value_priorities */
  valuePriorities: string[] | null;
  /** salon_culture_profiles.comment */
  comment: string | null;
  /** deriveSalonTypes() の結果から解決した、サロンのカルチャータイプ名（例: "仲間・チーム重視型"）。
   *  8タイプの再計算は行わない。既存のderiveSalonTypes()の結果をそのまま受け取るだけ。 */
  mainTypeName: string | null;
  subTypeName: string | null;
};

/** 12軸の日本語ラベルと「職場・組織文化」としての説明軸（推測せず、既存の定義に基づく）。
 *  education_support〜hierarchy_flatnessの8軸は、既存の
 *  supabase/migrations/0010_stylist_preference.sql・0011_stylist_salon_matching.sql
 *  で定義されている意味と同一のものを流用（軸名・意味を新しく定義していない）。
 *  technical_specialization/premium_value/trend_orientation/creative_outputの
 *  4軸も、lib/salon-culture/salon-culture-types.tsのAXIS_PHRASESで既に定義
 *  されている意味（技術専門性・高付加価値・トレンド志向・クリエイティブ発信）を
 *  そのまま踏襲する。 */
const AXIS_LABELS: Record<keyof SalonCultureAxes, string> = {
  education_support: "教育・フォロー体制",
  challenge_openness: "新しい挑戦への姿勢",
  personal_brand_support: "個人ブランド・発信支援",
  team_collaboration: "チームでの助け合い",
  individual_autonomy: "個人の裁量・自由度",
  work_flexibility: "働き方の柔軟性",
  technical_specialization: "技術の専門性",
  premium_value: "価格帯・提供価値の方向性",
  trend_orientation: "トレンドへの感度",
  creative_output: "発信・クリエイティブ活動",
  relationship_distance: "スタッフ同士の距離感（仕事以外も含む）",
  hierarchy_flatness: "上下関係・意見の言いやすさ",
  // 旧軸（新12軸には含めない。0009より前のデータにのみ存在しうる）。
  management_style: "経営スタイル（旧軸）",
  customer_relationship_style: "顧客との距離感（旧軸）",
  team_collaboration_style: "チーム協働スタイル（旧軸、未算出）",
};

/** 新12軸のみを対象にする（旧軸は職場文化として解釈しない）。 */
const NEW_TWELVE_AXIS_KEYS: (keyof SalonCultureAxes)[] = [
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
];

/**
 * サロンの組織文化データからAI解説を生成する。サーバー側（Route Handler /
 * Server Action）からのみ呼ぶこと。ANTHROPIC_API_KEY はここでのみ参照する。
 *
 * ★美容師本人向けの generateDiagnosisNarrative()（lib/ai/generate-diagnosis-narrative.ts）
 * とは完全に独立した実装。プロンプト文言・入力データを一切共用していない。
 * 6才能スコア（T/S/H/B/A/M）・美容師の診断結果は入力に一切含めない
 * （サロン14問診断のスコアを「人物評価」として解釈しない）。
 *
 * 失敗時（ネットワークエラー・APIエラー・JSONパース失敗等）は null を返す。
 * AI解説は「あれば良い」付加情報であり、salon_culture_profiles本体の保存を
 * ブロックしてはならないため、呼び出し元は失敗をエラーとして扱わずスキップしてよい
 * （美容師側と同じ方針）。
 */
export async function generateSalonCultureNarrative(
  input: GenerateInput,
): Promise<{ narrative: SalonCultureNarrative; model: string; promptVersion: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("generateSalonCultureNarrative: ANTHROPIC_API_KEY is not set");
    return null;
  }

  const prompt = buildPrompt(input);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      console.error("generateSalonCultureNarrative: API error", response.status);
      return null;
    }

    const data = await response.json();
    const text = (data.content ?? [])
      .map((block: { type: string; text?: string }) => (block.type === "text" ? block.text ?? "" : ""))
      .join("");

    const narrative = parseNarrative(text);
    if (!narrative) return null;

    return { narrative, model: MODEL, promptVersion: PROMPT_VERSION };
  } catch (err) {
    console.error("generateSalonCultureNarrative: request failed", err);
    return null;
  }
}

function buildPrompt(input: GenerateInput): string {
  const { cultureAxes, valuePriorities, comment, mainTypeName, subTypeName } = input;

  const axisLines = NEW_TWELVE_AXIS_KEYS.filter((key) => cultureAxes[key] != null).map(
    (key) => `${AXIS_LABELS[key]}: ${cultureAxes[key]}（0〜100、両端は良し悪しではなく特徴を表す）`,
  );

  return [
    "あなたは日本の美容業界向けサロン紹介ライターです。",
    "以下は、ある美容室（サロン）が回答した「組織文化」データです。",
    "これは美容師個人の才能・能力を評価するデータではありません。",
    "このサロンが『どんな職場・組織なのか』を、第三者（転職を検討している美容師）に向けて",
    "客観的に紹介する文章を日本語で作成してください。",
    "",
    "★重要な制約:",
    "・主語は必ず「このサロンは」「このサロンでは」「スタッフにとって」「〜しやすい環境です」のような、",
    "  サロンという組織を主語にした表現にしてください。",
    "・「あなたは」「あなたの才能」「あなたのキャリア」のような、読み手個人への呼びかけ・評価は",
    "  絶対に使わないでください。",
    "・「施術後の写真を撮ろう」「SNS投稿を始めよう」「コンテストへ挑戦しよう」",
    "  「スタイリストとして成長しよう」「後輩に技術を教えよう」のような、",
    "  美容師個人への行動指示・キャリアアドバイスは絶対に書かないでください。",
    "・断定的な推薦（「あなたに最適です」等）は避け、客観的な紹介にとどめてください。",
    "",
    mainTypeName ? `このサロンのカルチャータイプ（メイン）: ${mainTypeName}` : "",
    subTypeName ? `このサロンのカルチャータイプ（サブ）: ${subTypeName}` : "",
    "",
    "組織文化データ（各軸0〜100、両端はどちらも「良い/悪い」ではなくサロンの特徴を表す）:",
    ...axisLines,
    "",
    valuePriorities && valuePriorities.length > 0
      ? `このサロンが大切にしている価値観: ${valuePriorities.join("、")}`
      : "",
    comment ? `サロン自身のコメント: ${comment}` : "",
    "",
    "以下のJSON形式のみで返答してください（前後に説明文やコードフェンスを付けないこと）。",
    "{",
    '  "essence": "このサロンらしさを一言で表す総評を1〜2文で",',
    '  "explanation": "教育・挑戦・個人ブランド支援・チームワーク・裁量・働き方・距離感・上下関係などから、このサロンの組織文化を3〜4文で説明",',
    '  "advice": ["この環境で活躍しやすい美容師の特徴、またはこのサロンの魅力の活かし方を3つ、それぞれ短い一文で（美容師本人への行動指示ではないこと）"],',
    '  "growth": "このサロン文化の強み・今後さらに伸ばせる組織面について2〜3文で"',
    "}",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseNarrative(text: string): SalonCultureNarrative | null {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
  try {
    const parsed = JSON.parse(cleaned);
    if (
      typeof parsed.essence === "string" &&
      typeof parsed.explanation === "string" &&
      Array.isArray(parsed.advice) &&
      parsed.advice.every((a: unknown) => typeof a === "string") &&
      typeof parsed.growth === "string"
    ) {
      return parsed as SalonCultureNarrative;
    }
    return null;
  } catch {
    return null;
  }
}
