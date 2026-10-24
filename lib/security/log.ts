/**
 * サーバーログ用の安全なエラー出力。
 *
 * ★エラーオブジェクトをそのままログへ渡さない。PostgrestError の details / hint には、
 *   重複エラー等で行の値（メール・氏名・住所など）が含まれることがあるため。
 *   出すのは「どこで」「エラーコード」「短く切ったメッセージ」だけ。
 *   アクセストークン・service roleキー・Storageパス・請求先情報・口座情報は渡さないこと。
 */
type ErrorLike = { message?: unknown; code?: unknown } | null | undefined;

export function logError(where: string, error?: ErrorLike | unknown): void {
  const e = (error ?? {}) as { message?: unknown; code?: unknown };
  const message = typeof e.message === "string" ? e.message.slice(0, 200) : undefined;
  const code = typeof e.code === "string" ? e.code : undefined;
  console.error(`[${where}]`, { code, message });
}
