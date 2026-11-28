/**
 * 採用契約（入社意思確認・内定・請求予定）・スカウト台帳・採用料の自動請求ジョブの機能フラグ（サーバー側のみ・既定オフ）。
 * DB草案 0109・0110（提案・未適用）が前提。適用（レビュー・承認後）より前に有効にしない。
 * ★自動請求はこのフラグとは別で、DBの設定 auto_charge_enabled（既定 false）と未決定事項が揃うまで動かない。
 * ★有効を表す値は '1' だけ（画面・サーバー処理・請求ジョブで共通。'true' など他の値はすべてオフ）。判定はこのファイルの flagEnabled だけで行う。
 */
export const flagEnabled = (v: string | undefined): boolean => v === "1";
export function hireBillingEnabled(env: Record<string, string | undefined> = process.env): boolean { return flagEnabled(env.HIRE_BILLING_ENABLED); }
export function scoutLedgerEnabled(env: Record<string, string | undefined> = process.env): boolean { return flagEnabled(env.SCOUT_LEDGER_ENABLED); }

/** 本部によるサロンアカウント発行（0117・提案・未適用）。メール送信・認証アカウント作成を伴うため、既定オフ。有効を表す値は '1' だけ。 */
export function salonAccountIssueEnabled(env: Record<string, string | undefined> = process.env): boolean { return flagEnabled(env.SALON_ACCOUNT_ISSUE_ENABLED); }
/** 見学・体験料／採用料の手動請求・入金管理（0118・提案・未適用）。既定オフ。採用料の自動請求（HIRE_BILLING_ENABLED・auto_charge_enabled）とは別。 */
export function manualBillingEnabled(env: Record<string, string | undefined> = process.env): boolean { return flagEnabled(env.MANUAL_BILLING_ENABLED); }
