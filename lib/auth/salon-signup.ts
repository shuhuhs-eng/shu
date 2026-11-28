import { salonAccountIssueEnabled } from "@/lib/billing/hire-flags";

/**
 * サロンの一般新規登録を閉じるか。本部発行（SALON_ACCOUNT_ISSUE_ENABLED=1）に切り替えたときだけ閉じる
 * （発行の導線が無い状態で閉じて、サロンが登録できなくなるのを防ぐ）。
 * 本部発行の招待・パスワード設定（/auth/callback → /update-password）の導線は閉じない。
 */
export const salonSelfSignupClosed = (env: Record<string, string | undefined> = process.env): boolean => salonAccountIssueEnabled(env);
export const SALON_SIGNUP_CLOSED_MESSAGE = "サロンのアカウントは、運営（本部）からの招待制になりました。ご利用をご希望の方は、運営へお問い合わせください。";
