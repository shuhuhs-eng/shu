/**
 * 見学・体験入店の料金（各50,000円・税抜）の画面側の規則。DB草案 0108（提案・未適用）と同じ状態名・遷移。
 * ★二重請求防止の本体はDB（実施単位 admin_visit_occurrences.id への一意制約・行ロック・冪等キー）。ここは表示と事前判定だけで、最終判断はDB。
 * 請求は「実施の双方確認後（occurrence が attended）」にだけ生成される。希望送信・受付・日程確定では生成しない。
 * 決済方式は運営（責任者）の手動決済。自動決済ではない（採用料の自動請求とは別）。
 * ★この機能は「外部で行った決済の結果を記録する」もの。画面のボタンでカード請求は行われない。
 * ★失敗後の再開始は、再試行条件が決まるまで許さない（DBも拒否）。失敗した請求は取消のみ可能。
 */
export const EVENT_FEE_EXCL_TAX = 50000 as const;
export const TAX_PERCENT = 10 as const;
export function eventFeeAmounts(): { fee: number; tax: number; total: number } {
  const fee = EVENT_FEE_EXCL_TAX; const tax = Math.floor((fee * TAX_PERCENT) / 100);
  return { fee, tax, total: fee + tax };
}

export type FeeStatus = "pending_payment" | "payment_in_progress" | "paid" | "payment_failed" | "payment_unknown" | "cancelled";
export type FeeAction = "start_payment" | "resolve_unknown" | "cancel";
export const FEE_STATUS_LABELS: Record<FeeStatus, string> = {
  pending_payment: "決済前", payment_in_progress: "決済中", paid: "支払い済み", payment_failed: "決済失敗", payment_unknown: "結果不明（要確認）", cancelled: "取消",
};
const ALLOWED: Record<FeeAction, FeeStatus[]> = { start_payment: ["pending_payment"], resolve_unknown: ["payment_unknown"], cancel: ["pending_payment", "payment_failed"] };
/** 画面の操作可否（目安）。責任者以外は不可。結果不明は確認を記録するまで再請求不可。 */
export function canApplyFee(status: FeeStatus, action: FeeAction, isResponsible: boolean): { ok: true } | { ok: false; reason: string } {
  if (!isResponsible) return { ok: false, reason: "responsible_only" };
  if (ALLOWED[action].includes(status)) return { ok: true };
  return { ok: false, reason: status === "payment_unknown" ? "unknown_requires_confirmation" : "invalid_state" };
}

export function feeErrorMessage(m: string | undefined | null): string {
  const s = m ?? "";
  if (s.includes("insufficient permission")) return "料金・決済の操作は責任者のみ可能です。";
  if (s.includes("unknown payment result")) return "前回の決済結果が不明です。入金の有無を確認して記録するまで、新しい決済は始められません。";
  if (s.includes("retry policy")) return "決済に失敗した請求の再開始は、再試行の条件が決まるまでできません。取消するか、運営責任者へ相談してください。";
  if (s.includes("confirmation note")) return "確認した方法・場所（確認内容）を入力してください。";
  if (s.includes("explicitly")) return "入金の有無を選択してください。";
  if (s.includes("must not be empty")) return "決済の参照IDが空です。";
  if (s.includes("cancel reason")) return "取消の理由を入力してください。";
  if (s.includes("not payable")) return "この請求は現在、決済を開始できません。画面を読み込み直してください。";
  if (s.includes("already finished")) return "この決済の結果は記録済みです。画面を読み込み直してください。";
  if (s.includes("external reference required")) return "支払い済みとして記録するには、決済の参照IDが必要です。";
  if (s.includes("cannot be cancelled")) return "この請求は取消できません（支払い済み・決済中・結果不明は不可）。";
  if (s.includes("duplicate key") || s.includes("unique")) return "同じ決済IDが既に記録されています。内容を確認してください。";
  return "処理を完了できませんでした。画面を読み込み直して、もう一度お試しください。";
}
