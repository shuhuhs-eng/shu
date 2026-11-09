/** Supabase Auth CAPTCHA確認（scripts/verify-auth-captcha.mts）の判定。副作用なし。 */
export type CaptchaProbe = "enabled" | "disabled" | "unknown";

export function classifyCaptchaProbe(status: number, bodyText: string): CaptchaProbe {
  if (status === 200) return "disabled";
  if (status === 400 || status === 422) {
    return /captcha/i.test(bodyText) ? "enabled" : "unknown";
  }
  return "unknown";
}
