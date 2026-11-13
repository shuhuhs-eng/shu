import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  CLAIM_BINDING_FOR_APP_METADATA_KEY,
  CLAIM_BINDING_ISSUED_APP_METADATA_KEY,
  CLAIM_BINDING_TTL_MS,
  SIGNUP_CLOCK_SKEW_MS,
  SIGNUP_SELF_CONSISTENCY_MS,
} from "@/lib/diagnosis-handoff/constants";

/** 保留トークン（claim_token）のハッシュ。 */
export function hashClaimToken(claimToken: string): string {
  return createHash("sha256").update(claimToken).digest("hex");
}

/** Supabase Auth がサーバーで返したユーザー情報（引き継ぎ判定に使う分だけ）。 */
export type AuthUserForClaim = {
  id: string;
  created_at?: string | null;
  email_confirmed_at?: string | null;
  app_metadata?: Record<string, unknown> | null;
};

/** signUp の応答のユーザー（identities は登録済みメールの再登録で空になる）。 */
export type SignUpUser = AuthUserForClaim & {
  identities?: unknown[] | null;
  confirmation_sent_at?: string | null;
};

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
 * 「今回の signUp 要求で、本当に新しく作られたユーザー」かを、signUp の応答だけで判定する。次をすべて満たすこと。
 *  1. identities が空でない（登録済みメールでの再登録は空になる）
 *  2. サーバーだけが書ける app_metadata に「印を発行済み」の記録が無い
 *  3. 作成時刻が「この要求の開始時刻」以降（アプリとDBの時計のずれ分5秒だけ手前を許容）
 *  4. 自己整合: 作成時刻と、確認メール送信時刻（確認不要の設定では確認時刻）がほぼ同時（500ms以内）。
 *     ※5秒の許容だけでは、直前（1〜5秒前）に作られた確認待ちのアカウントへの再登録を区別できない。
 *       再登録では確認メール送信時刻が今に更新される一方、作成時刻は古いままなので、差が開いて弾ける。
 *       どちらもSupabase側の時計なので、アプリとのずれの影響を受けない。
 *       どちらの時刻も応答に無い場合は発行しない（安全側）。
 * 実Authでは、これらの時刻・identitiesが想定どおり返るかを未確認（README参照）。
 */
export function isUserCreatedBySignUp(user: SignUpUser, requestStartedAt: number, now: number = Date.now()): boolean {
  if (!Array.isArray(user.identities) || user.identities.length === 0) return false;
  if (user.app_metadata && user.app_metadata[CLAIM_BINDING_ISSUED_APP_METADATA_KEY]) return false;
  const created = user.created_at ? Date.parse(user.created_at) : NaN;
  if (!Number.isFinite(created)) return false;
  if (!(created >= requestStartedAt - SIGNUP_CLOCK_SKEW_MS && created - now <= 60_000)) return false;
  const anchor = user.confirmation_sent_at ?? user.email_confirmed_at ?? null;
  const anchorMs = anchor ? Date.parse(anchor) : NaN;
  if (!Number.isFinite(anchorMs)) return false;
  return Math.abs(anchorMs - created) <= SIGNUP_SELF_CONSISTENCY_MS;
}

/**
 * 署名付きの「新規登録の印」を作る。signUp が新しいユーザーを作った直後にだけ呼ぶ。
 * 秘密鍵が無い、トークンが無い、今回の要求で作られたユーザーでない場合は null。
 */
export function issueSignUpBinding(
  user: SignUpUser,
  claimToken: string | undefined | null,
  requestStartedAt: number,
  now: number = Date.now(),
): string | null {
  const secret = bindingSecret();
  if (!secret || !claimToken || !user.id) return null;
  if (!isUserCreatedBySignUp(user, requestStartedAt, now)) return null;
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
  // サーバーだけが書ける記録が、今のゲスト診断を指していること（同時要求では最後に書かれた1つだけが有効）
  if (!user.app_metadata || user.app_metadata[CLAIM_BINDING_FOR_APP_METADATA_KEY] !== hashClaimToken(claimToken)) return false;
  const m = /^(\d{10,16})\.([0-9a-f]{64})$/.exec(binding);
  if (!m) return false;
  const issuedAt = Number(m[1]);
  if (!Number.isFinite(issuedAt) || now - issuedAt > CLAIM_BINDING_TTL_MS || issuedAt - now > 60_000) return false;
  const expected = Buffer.from(sign(secret, user.id, claimToken, issuedAt), "hex");
  const actual = Buffer.from(m[2], "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
