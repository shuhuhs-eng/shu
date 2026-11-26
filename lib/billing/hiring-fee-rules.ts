/**
 * 採用料の確定済み規則（純粋ロジック。DB・Stripeへは触れない）。
 * 確定: スタイリスト550,000円・アシスタント450,000円（いずれも税抜・新卒/中途の差なし）／登録カードで入社予定日の翌日に自動請求／
 *       内定確定時には請求しない／入社意思確認（エージェントが必ず実施）から7日経ってもサロンが未操作なら、運営が代理操作できる（自動確定はしない）。
 *       代理で確定しても請求日は入社予定日の翌日。（D4確定: 基準は「最初に登録した入社予定日」。後から変更しても請求日は動かさない。請求前に未入社が確定したら請求せず取り消し、請求後なら確認後に返金。決済・返金は責任者のみ。）
 * 未確定（実装していない）: 決済失敗時の対応・再試行条件、カード未登録・期限切れ時の扱い、役職（スタイリスト/アシスタント）の判定元、
 *       入社予定日の変更・取消の請求予定への反映の細則、税の端数規則の最終確認。
 */
export type HireRole = "stylist" | "assistant";
export const HIRING_FEE_EXCL_TAX: Record<HireRole, number> = { stylist: 550000, assistant: 450000 };
export function hiringFeeAmounts(role: HireRole): { fee: number; tax: number; total: number } {
  const fee = HIRING_FEE_EXCL_TAX[role]; const tax = Math.floor((fee * 10) / 100); return { fee, tax, total: fee + tax };
}
/** 採用の経過段階。内定確定（サロンの「内定した」操作）では請求しない。 */
export type HireStage = "offer_confirmed" | "start_date_passed_plus_1";
export const stageChargesFee = (s: HireStage): boolean => s === "start_date_passed_plus_1";

/** 請求日（日本時間の暦日）= 入社予定日の翌日。YYYY-MM-DD。 */
export function chargeDateFor(startDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error("invalid start date");
  const d = new Date(`${startDate}T00:00:00Z`); if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== startDate) throw new Error("invalid start date");
  d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10);
}
/** 今日（日本時間）が請求日以降か。取消・辞退済みは対象外。 */
export function isChargeDue(startDate: string, todayJst: string, state: "active" | "cancelled" | "declined" = "active"): boolean {
  return state === "active" && todayJst >= chargeDateFor(startDate);
}
export const PROXY_WAIT_DAYS = 7 as const;
/** 運営がサロン操作を代理できるか。起点は「本人の入社意思確認の完了」（依頼日ではない）。期間経過だけで自動確定はしない。 */
export function canProxyConfirm(intentConfirmedAt: Date | null, salonActed: boolean, now: Date, isResponsible: boolean): { ok: boolean; reason?: string } {
  if (!isResponsible) return { ok: false, reason: "responsible_only" };
  if (!intentConfirmedAt) return { ok: false, reason: "stylist_intent_not_confirmed" };
  if (salonActed) return { ok: false, reason: "salon_already_acted" };
  return now.getTime() - intentConfirmedAt.getTime() >= PROXY_WAIT_DAYS * 86400000 ? { ok: true } : { ok: false, reason: "waiting_period" };
}
