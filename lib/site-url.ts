/**
 * メール認証・パスワード再設定のリダイレクトURLを組み立てる際の基点。
 * 本番では NEXT_PUBLIC_SITE_URL を必ず設定すること（未設定時は localhost にフォールバック）。
 */
export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}
