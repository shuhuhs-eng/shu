/**
 * 給与条件の「提示」の一時停止スイッチ（アプリ側）。
 *   ・既定は【停止中】。再開するには環境変数 SALARY_OFFER_PRESENTATION_PAUSED=false を設定する（コード変更・DB変更は不要）。
 *   ・止めるのは「新しい提示・再提示」だけ。すでに届いている提示の確認・回答（承諾・辞退・条件相談）は止めない。
 *   ・DB側（create_salary_offer_v2）は変更していない。このスイッチはアプリの画面と保存処理の停止であり、DBへ直接呼び出す経路まで
 *     止めるにはDB側の変更が必要（別途提案）。
 */
export const SALARY_OFFER_PAUSED_MESSAGE = "現在、給与条件の提示は一時停止しています。再開までお待ちください。";

export function isSalaryOfferPresentationPaused(env: Record<string, string | undefined> = process.env): boolean {
  return env.SALARY_OFFER_PRESENTATION_PAUSED !== "false";
}
