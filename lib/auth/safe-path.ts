/**
 * オープンリダイレクト対策: 同一オリジン内の絶対パスだけを許可する。
 * 拒否: "/" 以外で始まる値、"//"（プロトコル相対）、"/\"（ブラウザが "//" に正規化する）、
 *       制御文字・バックスラッシュを含む値。
 */
export function safeInternalPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2000) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  return raw;
}
