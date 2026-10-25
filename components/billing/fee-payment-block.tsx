import { StripeStartButton } from "./stripe-start-button";
import { PAYMENT_METHOD_LABELS } from "@/lib/stripe/labels";

type Info = { can_pay_by_card: boolean; card_checkout_in_progress: boolean; payment_method: "card" | "bank_transfer" | null } | undefined;

/**
 * 成功報酬1件ごとのお支払い方法。請求書（銀行振込）が基本で、カードは選べる追加手段。
 * ★金額はサーバーがDBの確定済み合計金額から決める。ここは「どの請求か」のIDしか渡さない。
 * ★「入金済み」になるのはStripeの決済確認(webhook)後。ボタンを押した／戻ってきただけでは変わらない。
 */
export function FeePaymentBlock({ organizationId, feeId, info, stripeReady }: {
  organizationId: string; feeId: string; info: Info; stripeReady: boolean;
}) {
  if (!info) return null;
  if (info.payment_method) {
    return <p className="mt-3 text-[11.5px] text-sub">お支払い方法　<span className="font-semibold text-charcoal">{PAYMENT_METHOD_LABELS[info.payment_method]}</span></p>;
  }
  if (!info.can_pay_by_card) return null;
  return (
    <div className="mt-3 rounded-xl bg-surface2 p-3.5">
      <p className="text-[12px] font-semibold text-charcoal">お支払い方法を選べます</p>
      <ul className="mt-1 list-disc pl-4 text-[11.5px] leading-relaxed text-sub">
        <li>銀行振込：請求書に記載の口座へお振込みください（運営が入金を確認します）。</li>
        <li>カード：下のボタンから、その場で支払えます。決済が確認できると自動で「入金済み」になります。</li>
      </ul>
      {info.card_checkout_in_progress && (
        <p className="mt-2 text-[11.5px] text-sub">カード決済の手続き中です。完了していない場合は、もう一度ボタンから続きを行えます。</p>
      )}
      {stripeReady ? (
        <div className="mt-2.5"><StripeStartButton kind="success_fee" organizationId={organizationId} feeId={feeId} label="カードで支払う" /></div>
      ) : (
        <p className="mt-2 text-[11.5px] text-sub">カード決済は現在準備中です。</p>
      )}
    </div>
  );
}
