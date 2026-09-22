import type { TraitScores } from "@/lib/diagnosis";

const MODEL = "claude-sonnet-4-6";
const PROMPT_VERSION = "1.0.0";

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
      console.error("generateDiagnosisNarrative: API error", response.status);
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
    console.error("generateDiagnosisNarrative: request failed", err);
    return null;
  }
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
