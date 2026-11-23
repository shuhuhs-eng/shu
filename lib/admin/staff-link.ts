/**
 * スタッフの招待・パスワード再設定リンク（採用方式の確定）。
 *
 * 方式: 管理API（generateLink）が返す hashed_token を使い、**自サイトの確認ページ**へのリンクを作る。
 *   {サイトURL}/auth/staff-invite?token_hash=...&type=recovery
 *  - リンクを開いただけではトークンを消費しない（メールの自動プレビュー・ウイルススキャナによる先行アクセスで使用済みにならない）。
 *    ページのボタンを押したときに初めて verifyOtp(token_hash) でサーバー側にセッションを作る。
 *  - 既存の /auth/callback（?code= の PKCE）・通常のログイン・新規登録・パスワード再設定は変更しない（別の入口）。
 *  - type は recovery（既定）。メール未確認の招待中アカウントも、リンクで本人確認が済む想定（★実Supabaseでの動作は分離環境で確認する）。
 * パスワードは本人が、リンクを開いた先の画面で設定する。責任者にもメールにも表示しない。
 */
export const STAFF_LINK_PATH = "/auth/staff-invite";
export const STAFF_PASSWORD_PATH = "/auth/staff-invite/password";
export const STAFF_LINK_TYPES = ["recovery", "invite"] as const;
export type StaffLinkType = (typeof STAFF_LINK_TYPES)[number];
/** 発行するリンクの種別。分離環境の試験で recovery が通らなければ invite へ切り替える（受け入れ側は両方を許可）。 */
export const STAFF_LINK_TYPE: StaffLinkType = "recovery";

const TOKEN_RE = /^[A-Za-z0-9._-]{16,256}$/;

export function buildStaffLink(siteUrl: string, tokenHash: string, type: StaffLinkType = STAFF_LINK_TYPE): string {
  if (!TOKEN_RE.test(tokenHash)) throw new Error("invalid token_hash");
  const base = siteUrl.replace(/\/+$/, "");
  return `${base}${STAFF_LINK_PATH}?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`;
}

type Param = string | string[] | undefined;
export type StaffLinkParams = { ok: true; tokenHash: string; type: StaffLinkType } | { ok: false };

/** ページ・アクションが受け取るクエリの検証。形式が違えば何もしない（トークンを認証APIへ渡さない）。 */
export function parseStaffLinkParams(sp: { token_hash?: Param; type?: Param }): StaffLinkParams {
  const one = (v: Param) => (typeof v === "string" ? v : Array.isArray(v) && v.length === 1 ? v[0] : undefined);
  const t = one(sp.token_hash), ty = one(sp.type);
  if (!t || !TOKEN_RE.test(t) || !ty || !(STAFF_LINK_TYPES as readonly string[]).includes(ty)) return { ok: false };
  return { ok: true, tokenHash: t, type: ty as StaffLinkType };
}

/** ログアウト後にリンクへ戻すための行き先（このページ以外へは戻さない）。 */
export function staffLinkReturnPath(p: StaffLinkParams): string {
  return p.ok ? `${STAFF_LINK_PATH}?token_hash=${encodeURIComponent(p.tokenHash)}&type=${p.type}` : STAFF_LINK_PATH;
}
