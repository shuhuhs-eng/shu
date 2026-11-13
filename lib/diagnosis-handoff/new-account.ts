import { createHash } from "node:crypto";
import {
  CLAIM_BINDING_METADATA_KEY,
  NEW_ACCOUNT_CONFIRMED_WITHIN_MS,
  NEW_ACCOUNT_CREATED_WITHIN_MS,
} from "@/lib/diagnosis-handoff/constants";

/** 保留トークン（claim_token）のハッシュ。トークンそのものは user_metadata に入れない。 */
export function hashClaimToken(claimToken: string): string {
  return createHash("sha256").update(claimToken).digest("hex");
}

/** ゲスト診断を「新規アカウントの初回結果」として引き継げるかの判定に使う、Authのユーザー情報（サーバーで取得したもの）。 */
export type AuthUserForClaim = {
  id: string;
  created_at?: string | null;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

/**
 * ゲスト診断を、このアカウントの初回結果として引き継いでよいかを判定する（純粋関数・副作用なし）。
 *
 * 次の条件を「すべて」満たす場合だけ true:
 *   1. 登録時にサーバーが入れた印（user_metadata の保留トークンのハッシュ）が、今ブラウザにある
 *      保留トークンのハッシュと一致する（＝この診断につながる登録として作られたアカウント）。
 *   2. アカウントの作成が最近（48時間以内）。
 *   3. メール確認（登録）が「たった今」（10分以内）。すでに確認済みの既存アカウントのログイン・
 *      パスワード再設定では、これが満たされない。
 * URLのフラグやブラウザ内の印は使わない。判定は Supabase Auth がサーバーで返したユーザー情報だけで行う。
 */
export function isFreshAccountBoundToClaimToken(
  user: AuthUserForClaim,
  claimToken: string | undefined | null,
  now: number = Date.now(),
): boolean {
  if (!claimToken) return false;

  const bound = user.user_metadata?.[CLAIM_BINDING_METADATA_KEY];
  if (typeof bound !== "string" || bound !== hashClaimToken(claimToken)) return false;

  const created = user.created_at ? Date.parse(user.created_at) : NaN;
  if (!Number.isFinite(created) || now - created > NEW_ACCOUNT_CREATED_WITHIN_MS || created > now + 60_000) {
    return false;
  }

  const confirmed = user.email_confirmed_at ? Date.parse(user.email_confirmed_at) : NaN;
  if (!Number.isFinite(confirmed) || now - confirmed > NEW_ACCOUNT_CONFIRMED_WITHIN_MS || confirmed > now + 60_000) {
    return false;
  }

  return true;
}
