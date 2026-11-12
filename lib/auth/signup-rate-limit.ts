import { SIGNUP_RATE_LIMITS } from "@/lib/rate-limit/config";
import { checkSharedRateLimit, reserveSlot, type SlotReservation } from "@/lib/rate-limit/shared-rate-limiter";
import type { RateLimitResult, SlotOutcome } from "@/lib/rate-limit/memory-rate-limiter";

export type SignupLimitResult =
  | {
      allowed: true;
      /**
       * Supabase Authの応答が分かったら、1回だけ呼ぶ。
       *   "release": CAPTCHA検証に失敗した（captcha_failed）。メール単位の枠を消費しない。
       *   "confirm": それ以外（成功・既存メール・メール送信失敗など）。メール単位の枠を消費する。
       * 呼ばれなかった場合（通信切断・プロセス終了など）は、期限（pendingTtlMs）で自動的に枠から外れる。
       */
      settle: (outcome: SlotOutcome) => Promise<void>;
    }
  | { allowed: false; scope: "email" | "email_busy" | "ip"; retryAfterSeconds: number };

export type SignupLimitDeps = {
  checkIp?: (key: string, limit: number, windowMs: number) => Promise<RateLimitResult>;
  reserve?: (key: string, limits: Parameters<typeof reserveSlot>[1]) => Promise<SlotReservation>;
  limits?: { [K in keyof typeof SIGNUP_RATE_LIMITS]: number };
};

/**
 * 新規登録（美容師・サロン共通）のアプリ側レート制限。
 *
 * CAPTCHAの検証はSupabase Auth（signUp内）が行うため、制限を数える時点では未検証。
 * トークンは1回しか検証できないので、アプリ側で先に検証して二重検証にはしない。代わりに:
 *   1. IP単位の制限（既存の check_rate_limit。安全弁。Supabase Authへの大量要求を抑える。偽トークンでも消費したままにする）。
 *      IP制限で止まった要求は、メール単位の枠へ到達しない（検証中の枠を占められない）。
 *   2. メール単位は「予約ID方式」: 検証中(pending)の予約を作り、signUpの結果で確定(confirm)または返却(release)する。
 *      拒否された要求は予約を作らない（返却が不要）。
 *      ・確定済みが perEmail 以上 → 拒否（limit）。確認メールを送りすぎない主制限（有効なCAPTCHAを通った要求だけが数えられる）。
 *      ・検証中が perEmailInflight 以上 → 拒否（busy）。数秒後に再試行できる一時的な拒否。
 *      ・返却されなかった予約は、期限で自動的に枠から外れる。
 * ★限界: 偽トークンの要求も、Supabaseの応答待ちの間は「検証中」の枠を占める。同時に perEmailInflight 件以上を
 *   保ち続けられると、その間は本人の要求が busy で一時的に拒否される（永続的ではない。IP制限が総量を抑える）。
 * IPが取れない場合は、全員共通の厳しい上限にせず、緩い全体の安全弁を使う。
 */
export async function checkSignupRateLimit(
  input: { ip: string; email: string },
  deps: SignupLimitDeps = {},
): Promise<SignupLimitResult> {
  const checkIp = deps.checkIp ?? checkSharedRateLimit;
  const reserve = deps.reserve ?? reserveSlot;
  const L = deps.limits ?? SIGNUP_RATE_LIMITS;

  const noIp = !input.ip || input.ip === "unknown";
  const ipResult = noIp
    ? await checkIp("signup:noip", L.noIp, L.windowMs)
    : await checkIp(`signup:ip:${input.ip}`, L.perIp, L.windowMs);
  if (!ipResult.allowed) return { allowed: false, scope: "ip", retryAfterSeconds: ipResult.retryAfterSeconds };

  // 0055 のメール枠は、旧来の `signup:email:` カウンター（check_rate_limit）とは別のキー空間・別のテーブル。
  const slot = await reserve(`signup:email2:${input.email.toLowerCase()}`, {
    confirmedLimit: L.perEmail,
    inflightLimit: L.perEmailInflight,
    windowMs: L.windowMs,
    pendingTtlMs: L.pendingTtlMs,
  });
  if (!slot.allowed) {
    return { allowed: false, scope: slot.reason === "busy" ? "email_busy" : "email", retryAfterSeconds: slot.retryAfterSeconds };
  }
  return { allowed: true, settle: slot.settle };
}

/** 制限時の案内。アクセス集中などとは断定せず、制限の種類と再試行できるまでの目安を示す。 */
export function signupRateLimitMessage(r: Extract<SignupLimitResult, { allowed: false }>): string {
  if (r.scope === "email_busy") {
    return "このメールアドレスで別の登録処理を確認しています。数秒後に、もう一度お試しください。";
  }
  const minutes = Math.max(1, Math.ceil(r.retryAfterSeconds / 60));
  const wait = minutes >= 60 ? "約1時間後" : `約${minutes}分後`;
  return r.scope === "email"
    ? `このメールアドレスでの登録の試行回数が上限に達しました。${wait}に、もう一度お試しください。`
    : `このネットワークからの登録の試行回数が上限に達しました。${wait}に、もう一度お試しください。`;
}
