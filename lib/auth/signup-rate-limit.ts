import { SIGNUP_RATE_LIMITS } from "@/lib/rate-limit/config";
import { checkSharedRateLimit } from "@/lib/rate-limit/shared-rate-limiter";
import type { RateLimitResult } from "@/lib/rate-limit/memory-rate-limiter";

export type SignupLimitResult =
  | { allowed: true }
  | { allowed: false; scope: "email" | "ip"; retryAfterSeconds: number };

export type SignupLimitDeps = {
  check?: (key: string, limit: number, windowMs: number) => Promise<RateLimitResult>;
  limits?: typeof SIGNUP_RATE_LIMITS;
};

/**
 * 新規登録（美容師・サロン共通）のアプリ側レート制限。
 *   1. メール単位を先に確認する。超過なら、そこで止める（IPの回数は消費しない）。
 *      → 同じアドレスを連打されても、同じネットワークの別の人の登録枠を使い切らない。
 *   2. IP単位（安全弁）。IPが取れない場合は「全員共通の厳しい上限」にせず、緩い全体の安全弁にする。
 * 1回の操作につき、各キーを1回だけ数える（二重計上しない）。
 */
export async function checkSignupRateLimit(
  input: { ip: string; email: string },
  deps: SignupLimitDeps = {},
): Promise<SignupLimitResult> {
  const check = deps.check ?? checkSharedRateLimit;
  const L = deps.limits ?? SIGNUP_RATE_LIMITS;

  const emailResult = await check(`signup:email:${input.email.toLowerCase()}`, L.perEmail, L.windowMs);
  if (!emailResult.allowed) {
    return { allowed: false, scope: "email", retryAfterSeconds: emailResult.retryAfterSeconds };
  }

  const noIp = !input.ip || input.ip === "unknown";
  const ipResult = noIp
    ? await check("signup:noip", L.noIp, L.windowMs)
    : await check(`signup:ip:${input.ip}`, L.perIp, L.windowMs);
  if (!ipResult.allowed) {
    return { allowed: false, scope: "ip", retryAfterSeconds: ipResult.retryAfterSeconds };
  }
  return { allowed: true };
}

/** 制限時の案内。アクセス集中などとは断定せず、制限の種類と再試行できるまでの目安を示す。 */
export function signupRateLimitMessage(r: Extract<SignupLimitResult, { allowed: false }>): string {
  const minutes = Math.max(1, Math.ceil(r.retryAfterSeconds / 60));
  const wait = minutes >= 60 ? "約1時間後" : `約${minutes}分後`;
  return r.scope === "email"
    ? `このメールアドレスでの登録の試行回数が上限に達しました。${wait}に、もう一度お試しください。`
    : `このネットワークからの登録の試行回数が上限に達しました。${wait}に、もう一度お試しください。`;
}
