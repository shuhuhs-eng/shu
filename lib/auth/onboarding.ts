/**
 * onboarding_step の名前付き定数。
 *
 *   ACCOUNT_CREATED (0)    会員登録直後（handle_new_user トリガーが自動設定）
 *   PROFILE_COMPLETED (1)  オンボーディングのプロフィール入力（公開情報・個人情報）を保存した
 *   DIAGNOSIS_CLAIMED (2)  未ログイン時に受けた診断結果を本人へ紐づけた（任意ステップ）
 *   SETTINGS_COMPLETED (3) スカウト受信設定・公開範囲などの設定を確認・保存した
 *   COMPLETE (4)           オンボーディング完了
 *
 * 完了条件（isOnboardingComplete）:
 *   COMPLETE に到達していること（step >= COMPLETE）のみを見る。
 *
 *   COMPLETE へ進めるために必須なのは PROFILE_COMPLETED と SETTINGS_COMPLETED の完了のみ。
 *   DIAGNOSIS_CLAIMED は「診断結果を持っているユーザーだけが通過する任意のステップ」であり、
 *   未診断のままアカウント登録・利用を続けるユーザーは、この値を一度も経由せずに
 *   PROFILE_COMPLETED → COMPLETE へ進んでよい（＝完了の必須条件から除外する）。
 *
 *   本実装（Phase 4後半）のオンボーディング入力画面は、公開情報・個人情報に加えて
 *   スカウト受信設定・公開範囲も同一フォーム内で収集するため、初回保存が成功した時点で
 *   PROFILE_COMPLETED と SETTINGS_COMPLETED の両条件を同時に満たしたとみなし、
 *   onboarding_step を COMPLETE (4) へ直接進める。
 *   1/3 の中間値は、将来これらが別画面に分割された場合のために予約されている
 *   （そのときは各画面の保存処理でこの値をセットするよう拡張する）。
 */
export const ONBOARDING_STEP = {
  ACCOUNT_CREATED: 0,
  PROFILE_COMPLETED: 1,
  DIAGNOSIS_CLAIMED: 2,
  SETTINGS_COMPLETED: 3,
  COMPLETE: 4,
} as const;

export type OnboardingStep = (typeof ONBOARDING_STEP)[keyof typeof ONBOARDING_STEP];

/** COMPLETE に到達しているか。DIAGNOSIS_CLAIMED を経由したかどうかは問わない。 */
export function isOnboardingComplete(step: number): boolean {
  return step >= ONBOARDING_STEP.COMPLETE;
}

/**
 * プロフィール保存（公開情報・個人情報・スカウト受信設定・公開範囲を含む）が
 * 成功した後に設定すべき onboarding_step を返す。
 * 既に現在値がそれ以上進んでいる場合は後退させない（Math.max）。
 */
export function nextStepAfterProfileSave(currentStep: number): number {
  return Math.max(currentStep, ONBOARDING_STEP.COMPLETE);
}
