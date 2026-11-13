import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { CLAIM_BINDING_TTL_MS, SIGNUP_CREATED_WITHIN_MS } from "@/lib/diagnosis-handoff/constants";

/** 保留トークン（claim_token）のハッシュ。 */
export function hashClaimToken(claimToken: string): string {
  return createHash("sha256").update(claimToken).digest("hex");
}

/** Supabase Auth がサーバーで返したユーザー情報（引き継ぎ判定に使う分だけ）。 */
export type AuthUserForClaim = {
  id: string;
  created_at?: string | null;
  email_confirmed_at?: string | null;
};

/** signUp の応答のユーザー（identities は登録済みメールの再登録で空になる）。 */
export type SignUpUser = AuthUserForClaim & { identities?: unknown[] | null };

/**
 * 署名に使う秘密鍵。サーバー専用の環境変数（SUPABASE_SERVICE_ROLE_KEY）から、用途専用に派生させる。
 * 未設定なら null（署名できない＝引き継ぎは起きない。安全側に倒す）。
 */
function bindingSecret(): string | null {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) return null;
  return createHmac("sha256", base).update("beauty-reach/guest-claim-binding/v1").digest("hex");
}

function sign(secret: string, userId: string, claimToken: string, issuedAt: number): string {
  return createHmac("sha256", secret)
    .update(`${userId}|${hashClaimToken(claimToken)}|${issuedAt}`)
    .digest("hex");
}

/**
 * 「今回の signUp で、本当に新しく作られたユーザー」かを、signUp の応答だけで判定する。
 *  ・identities が空でない（登録済みメールでの再登録は空になる）
 *  ・作成時刻が「今」から2分以内（確認待ちの既存ユーザーで再登録した場合は、作成時刻が過去になる）
 */
export function isUserCreatedBySignUp(user: SignUpUser, now: number = Date.now()): boolean {
  if (!Array.isArray(user.identities) || user.identities.length === 0) return false;
  const created = user.created_at ? Date.parse(user.created_at) : NaN;
  if (!Number.isFinite(created)) return false;
  return now - created <= SIGNUP_CREATED_WITHIN_MS && created - now <= 60_000;
}

/**
 * 署名付きの「新規登録の印」を作る。signUp が新しいユーザーを作った直後にだけ呼ぶ。
 * 秘密鍵が無い、トークンが無い、新しいユーザーでない場合は null。
 */
export function issueSignUpBinding(
  user: SignUpUser,
  claimToken: string | undefined | null,
  now: number = Date.now(),
): string | null {
  const secret = bindingSecret();
  if (!secret || !claimToken || !user.id) return null;
  if (!isUserCreatedBySignUp(user, now)) return null;
  return `${now}.${sign(secret, user.id, claimToken, now)}`;
}

/**
 * 引き継ぎ可否: 「新規登録の印」が、この（ユーザーID × 今のゲスト診断）に対してサーバーが発行した本物で、
 * 有効期限内であること。既存会員は、自分のIDに対する印をサーバーから受け取れない（発行は新規作成の直後だけ）。
 * 利用者が書き換えられる user_metadata は一切見ない。
 */
export function verifySignUpBinding(
  binding: string | undefined | null,
  user: AuthUserForClaim,
  claimToken: string | undefined | null,
  now: number = Date.now(),
): boolean {
  const secret = bindingSecret();
  if (!secret || !binding || !claimToken || !user.id) return false;
  const m = /^(\d{10,16})\.([0-9a-f]{64})$/.exec(binding);
  if (!m) return false;
  const issuedAt = Number(m[1]);
  if (!Number.isFinite(issuedAt) || now - issuedAt > CLAIM_BINDING_TTL_MS || issuedAt - now > 60_000) return false;
  const expected = Buffer.from(sign(secret, user.id, claimToken, issuedAt), "hex");
  const actual = Buffer.from(m[2], "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
