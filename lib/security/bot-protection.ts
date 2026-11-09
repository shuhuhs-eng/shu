/**
 * Bot対策（Cloudflare Turnstile）。
 *
 * ★方針（Phase 54）
 *   ・Supabase Auth（signup / login / password reset）:
 *       サインアップ等はブラウザからSupabase Authへ直接アクセスもできるため、本当に防げるのは
 *       Supabase側の「Auth CAPTCHA」（Dashboard > Authentication > Attack Protection）だけ。
 *       そのため、アプリは Turnstile のトークンを `captchaToken` として Supabase へ渡し、検証は Supabase に任せる
 *       （Turnstileのトークンは1回しか検証できないため、アプリが先に検証すると Supabase 側が失敗する）。
 *       アプリ側では「本番ではトークン無しの送信をSupabaseへ流さない」ことだけを保証する（requireCaptchaToken）。
 *       Supabase側のCAPTCHAが有効かどうかは `npm run verify:auth-captcha` で確認する。
 *   ・Supabase Authを通らないAPI（アカウント復旧の問い合わせ等）:
 *       サーバーが Cloudflare の siteverify でトークンを検証する（verifyBotProtection）。
 *
 * ★fail-closed（fail-open禁止）
 *   ・本番（NODE_ENV=production）: TURNSTILE_SECRET_KEY が無い／トークンが無い／検証APIに到達できない／
 *     検証失敗 → すべて拒否。
 *   ・開発: 開発用の明示フラグ BOT_PROTECTION_DEV_BYPASS=true のときだけ素通りする。
 *     フラグが無ければ開発でも検証する（鍵が無ければ拒否）。
 *   ・BOT_PROTECTION_DEV_BYPASS は NODE_ENV=production では絶対に有効にならない
 *     （値が true でも無視し、さらに lib/env/validate.ts が本番での設定をエラーにする）。
 *   ・secret・トークンの値はログへ出さない。
 */

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_FORM_FIELD = "cf-turnstile-response";
/** トークンの現実的な上限（Cloudflareは2048文字以内）。巨大な値でsiteverifyへ投げない。 */
const MAX_TOKEN_LENGTH = 2048;

type Env = Record<string, string | undefined>;

export function isProductionEnv(env: Env = process.env): boolean {
  return env.NODE_ENV === "production";
}

/** 開発用の明示的なbypassが有効か。本番では常にfalse。 */
export function isBotProtectionBypassed(env: Env = process.env): boolean {
  if (isProductionEnv(env)) return false;
  return env.BOT_PROTECTION_DEV_BYPASS === "true";
}

export type BotCheckDeps = {
  env?: Env;
  fetchImpl?: typeof fetch;
};

export type BotCheckResult = { ok: true } | { ok: false; reason: "missing_token" | "not_configured" | "rejected" | "unreachable" };

/**
 * Turnstileのトークンをサーバーで検証する（fail-closed）。
 * 戻り値のreasonはログ・分岐用で、利用者へ詳細を出す必要はない。
 */
export async function checkTurnstileToken(
  token: string | null | undefined,
  remoteIp: string | null | undefined,
  deps: BotCheckDeps = {},
): Promise<BotCheckResult> {
  const env = deps.env ?? process.env;
  if (isBotProtectionBypassed(env)) return { ok: true };

  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return { ok: false, reason: "not_configured" };

  const t = typeof token === "string" ? token.trim() : "";
  if (!t || t.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "missing_token" };

  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const body = new URLSearchParams({ secret, response: t });
    if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);
    const res = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, reason: "unreachable" };
    const data = (await res.json()) as { success?: unknown };
    return data.success === true ? { ok: true } : { ok: false, reason: "rejected" };
  } catch {
    // ネットワーク断・タイムアウト・不正なレスポンスは拒否（fail-open禁止）。
    return { ok: false, reason: "unreachable" };
  }
}

/** 既存呼び出し（account-recovery等）向けの真偽値版。 */
export async function verifyBotProtection(
  token: string | null,
  remoteIp?: string | null,
  deps: BotCheckDeps = {},
): Promise<boolean> {
  const result = await checkTurnstileToken(token, remoteIp, deps);
  if (!result.ok && result.reason !== "missing_token" && result.reason !== "rejected") {
    // 設定不備・検証APIへ到達できない場合だけ運用者向けに記録する（値は出さない）。
    console.error("[bot-protection] verification unavailable", { reason: result.reason });
  }
  return result.ok;
}

/**
 * Supabase Authへ渡すCAPTCHAトークンを取り出す。
 *   ・本番: トークンが空なら null（呼び出し側は拒否する）。
 *   ・開発bypass時: トークン無しでも通す（undefinedを返す＝captchaTokenを付けない）。
 */
export function readCaptchaToken(formData: FormData): string | null {
  const v = formData.get(TURNSTILE_FORM_FIELD);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= MAX_TOKEN_LENGTH ? t : null;
}

/**
 * Supabase Authの呼び出し前チェック。
 *   ok:true → captchaToken（無い場合はundefined）をSupabaseへ渡してよい。
 *   ok:false → 呼び出さず、利用者に「確認を完了してください」を出す。
 * 本番ではトークン必須。開発はBOT_PROTECTION_DEV_BYPASS=true のときだけ省略可。
 */
export function requireCaptchaToken(
  formData: FormData,
  env: Env = process.env,
): { ok: true; captchaToken: string | undefined } | { ok: false } {
  const token = readCaptchaToken(formData);
  if (token) return { ok: true, captchaToken: token };
  if (isBotProtectionBypassed(env)) return { ok: true, captchaToken: undefined };
  return { ok: false };
}

export const CAPTCHA_REQUIRED_MESSAGE = "確認（ロボットでないことの確認）が完了していません。画面の表示を待ってから、もう一度お試しください。";
