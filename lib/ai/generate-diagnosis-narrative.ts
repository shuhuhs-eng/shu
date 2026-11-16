import type { TraitScores } from "@/lib/diagnosis";
import { logError } from "@/lib/security/log";
import { calculateCoreType } from "@/lib/diagnosis/core-types";
import { CORE_TYPE_CONTENT } from "@/lib/diagnosis/core-type-content";
import { NEWGRAD_COMMON_NOTE, NEWGRAD_TYPE_CONTENT } from "@/lib/diagnosis/newgrad-content";
import { NEWGRAD_VERSION } from "@/lib/diagnosis/newgrad";

const MODEL = "claude-sonnet-4-6";
const PROMPT_VERSION = "1.0.0";
/** 新卒版（stylist_newgrad_30_v1）専用の指示。経験者向けの才能・市場価値・年収の前提を使わない。 */
const NEWGRAD_PROMPT_VERSION = "newgrad-1.0.0";

export type DiagnosisNarrative = {
  essence: string;
  explanation: string;
  advice: string[];
  growth: string;
};

type GenerateInput = {
  typeName: string;
  scores: TraitScores;
  marketValueScore: number | null;
  salaryBand: string | null;
  /** 保存された診断バージョン。新卒版のときは新卒専用の指示で生成する。 */
  diagnosisVersion?: string;
};

/**
 * 診断結果からAI解説を生成する。サーバー側（Route Handler / Server Action）からのみ呼ぶこと。
 * ANTHROPIC_API_KEY はここでのみ参照し、クライアントへは一切渡さない。
 *
 * 失敗時（ネットワークエラー・APIエラー・JSONパース失敗等）は null を返す。
 * AI解説は「あれば良い」付加情報であり、診断結果本体(diagnosis_results)の保存を
 * ブロックしてはならないため、呼び出し元は失敗をエラーとして扱わずスキップしてよい。
 */
export async function generateDiagnosisNarrative(
  input: GenerateInput,
): Promise<{ narrative: DiagnosisNarrative; model: string; promptVersion: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("generateDiagnosisNarrative: ANTHROPIC_API_KEY is not set");
    return null;
  }

  const isNewgrad = input.diagnosisVersion === NEWGRAD_VERSION;
  const prompt = isNewgrad ? buildNewgradPrompt(input) : buildPrompt(input);

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
      console.error("generateDiagnosisNarrative: API error", response.status);
      return null;
    }

    const data = await response.json();
    const text = (data.content ?? [])
      .map((block: { type: string; text?: string }) => (block.type === "text" ? block.text ?? "" : ""))
      .join("");

    const narrative = parseNarrative(text);
    if (!narrative) return null;

    return { narrative, model: MODEL, promptVersion: isNewgrad ? NEWGRAD_PROMPT_VERSION : PROMPT_VERSION };
  } catch (err) {
    logError("generateDiagnosisNarrative", err);
    return null;
  }
}

/**
 * 新卒版の指示。数値（6軸）は判定用の内部値で、能力点として渡さない。
 * 禁止: 技術力・接客力などの実力評価、予測年収・市場価値、他タイプとの優劣、将来の成果や適性の断定、一つの回答からの人格決めつけ。
 */
export function buildNewgradPrompt(input: GenerateInput): string {
  const code = calculateCoreType(input.scores).topType;
  const name = CORE_TYPE_CONTENT[code].name;
  const c = NEWGRAD_TYPE_CONTENT[code];
  return [
    "あなたは、これから美容師として働く人（美容学生・新卒予定者）向けのガイドのライターです。",
    "以下のタイプ説明だけを根拠に、本人が前向きに読める解説を日本語で作成してください。",
    "",
    `タイプ: ${name}`,
    `見出し: ${c.headline}`,
    `説明: ${c.body}`,
    `表示する傾向: ${c.tendency}`,
    `試してみること: ${c.tryThis}`,
    `共通の注記: ${NEWGRAD_COMMON_NOTE}`,
    `書いてはいけないこと: ${c.writerNote}`,
    "",
    "必ず守ること:",
    "- 回答から見える興味や取り組み方の傾向として書く。現在の技術力・接客力・将来の成果や適性を評価・断定しない。",
    "- 年収・市場価値・順位・他のタイプとの優劣・伸びしろの大小には触れない。",
    "- 実務経験や接客実績、指名があることを前提にしない。学校の実習は実務実績として扱わない。",
    "- 一つの回答から性格や能力を決めつけない。数値や点数は書かない。",
    "",
    "以下のJSON形式のみで返答してください（前後に説明文やコードフェンスを付けないこと）。",
    "{",
    '  "essence": "このタイプの傾向を1〜2文で",',
    '  "explanation": "この傾向が学び方や取り組み方にどう表れやすいかを3〜4文で",',
    '  "advice": ["いまの学び方で試せる具体的な行動を3つ、それぞれ短い一文で"],',
    '  "growth": "これから経験を重ねる中で、傾向がどう変わりうるかを2〜3文で（断定しない）"',
    "}",
  ].join("\n");
}

function buildPrompt(input: GenerateInput): string {
  const { typeName, scores, marketValueScore, salaryBand } = input;
  return [
    "あなたは日本の美容師向けキャリア診断サービスのライターです。",
    "以下の診断結果をもとに、本人が読んで前向きになれる解説を日本語で作成してください。",
    "",
    `タイプ: ${typeName}`,
    `6才能スコア: 技術=${scores.T} 感性=${scores.S} 接客=${scores.H} 発信=${scores.B} 挑戦=${scores.A} 育成=${scores.M}`,
    marketValueScore != null ? `市場価値スコア: ${marketValueScore}` : "",
    salaryBand ? `想定年収帯: ${salaryBand}` : "",
    "",
    "以下のJSON形式のみで返答してください（前後に説明文やコードフェンスを付けないこと）。",
    "{",
    '  "essence": "このタイプの本質を1〜2文で",',
    '  "explanation": "スコアの組み合わせが意味することを3〜4文で",',
    '  "advice": ["今すぐできる具体的なアクションを3つ、それぞれ短い一文で"],',
    '  "growth": "今後のキャリアの伸びしろについて2〜3文で"',
    "}",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseNarrative(text: string): DiagnosisNarrative | null {
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
      return parsed as DiagnosisNarrative;
    }
    return null;
  } catch {
    return null;
  }
}
