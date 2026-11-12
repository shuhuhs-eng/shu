import type { SalonAiJobResult } from "@/lib/salon-culture/run-culture-ai-job";

/** サロンAI紹介文（salon-culture-v1）の現行版が揃っているとみなす出力種別。 */
export const SALON_AI_OUTPUT_TYPES = ["essence", "explanation", "advice", "growth"] as const;

export type SalonAiRetryResult =
  | { status: "generated" }
  | { status: "exists" }
  | { status: "not_completed" }
  | { status: "busy"; error: string }
  | { status: "failed"; error: string };

export type SalonAiRetryInput = {
  /** salon_culture_profiles.status === "completed" か。 */
  completed: boolean;
  /** 現行版(is_current)として保存済みの出力種別。 */
  existingCurrentTypes: string[];
  /** 共有レート制限（DB）。拒否されたら生成しない。 */
  limiter: (key: string, limit: number, windowMs: number) => Promise<{ allowed: boolean }>;
  userId: string;
  runJob: () => Promise<SalonAiJobResult>;
};

export const SALON_AI_RETRY_DEDUPE_MS = 2 * 60 * 1000;
export const SALON_AI_RETRY_HOURLY_LIMIT = 5;

/**
 * 回答済みなのにAI紹介文が無い場合の再生成。
 *  1. 未回答は生成しない。 2. 4種とも現行版が揃っていれば何もしない（重複生成しない）。
 *  3. 重複実行の抑止: ユーザー単位で2分に1回だけ生成を開始できる（共有DBのレート制限。複数インスタンス・連打でも1回）。
 *  4. 費用の上限: 1時間に5回まで。 5. 生成・保存の失敗は、そのまま「失敗」として返す（成功に見せない）。
 * ★DBに「生成中」の状態列が無いため、別インスタンスの生成が2分を超えて続いている場合の完全な排他は保証しない
 *   （その場合も保存は is_current の一意制約で現行版が1件に保たれ、画面には最新のものが出る）。
 */
export async function runSalonAiRetry(input: SalonAiRetryInput): Promise<SalonAiRetryResult> {
  if (!input.completed) return { status: "not_completed" };
  const have = new Set(input.existingCurrentTypes);
  if (SALON_AI_OUTPUT_TYPES.every((t) => have.has(t))) return { status: "exists" };

  const dedupe = await input.limiter(`salon-culture-ai-gen:${input.userId}`, 1, SALON_AI_RETRY_DEDUPE_MS);
  if (!dedupe.allowed) {
    return { status: "busy", error: "AI紹介文を作成中の可能性があります。2分ほど待ってから、画面を更新してください。" };
  }
  const hourly = await input.limiter(`salon-culture-ai-gen-h:${input.userId}`, SALON_AI_RETRY_HOURLY_LIMIT, 60 * 60 * 1000);
  if (!hourly.allowed) {
    return { status: "busy", error: "AI紹介文の作成回数が上限に達しました。しばらく時間をおいてお試しください。" };
  }

  const result = await input.runJob();
  if (result.status === "ok") return { status: "generated" };
  // 原因コード（固定の短い値のみ。キー・本文・個人情報は含まない）を添える。失敗を隠さず、原因の切り分けに使う。
  const code = `（原因コード: ${result.reason}）`;
  return {
    status: "failed",
    error:
      result.status === "partial"
        ? `AI紹介文の一部しか保存できませんでした。時間をおいて、もう一度お試しください。${code}`
        : `AI紹介文の作成に失敗しました。時間をおいて、もう一度お試しください。${code}`,
  };
}
