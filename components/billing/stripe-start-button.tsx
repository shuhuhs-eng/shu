"use client";

import { useState, useTransition } from "react";
import {
  openCustomerPortalAction, startCardRegistrationAction, startMonthlySubscriptionAction,
  startScoutCreditPurchaseAction, startSuccessFeeCardPaymentAction,
} from "@/lib/stripe/actions";
import { isAllowedStripeRedirect } from "@/lib/stripe/errors";

type Props =
  | { kind: "card" | "subscription" | "portal"; organizationId: string; label: string; variant?: "primary" | "secondary" }
  | { kind: "success_fee"; organizationId: string; feeId: string; label: string; variant?: "primary" | "secondary" }
  | { kind: "scout_credits"; organizationId: string; packageId: string; label: string; variant?: "primary" | "secondary" };

/**
 * Stripeの決済画面へ進むボタン。ブラウザから渡すのは「どの会社/請求/商品か」のIDだけで、
 * 金額はサーバー側がDBから確定する。遷移先はStripeのホスティング画面(https)だけを許可する。
 */
export function StripeStartButton(props: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    start(async () => {
      let result;
      switch (props.kind) {
        case "card": result = await startCardRegistrationAction({ organizationId: props.organizationId }); break;
        case "subscription": result = await startMonthlySubscriptionAction({ organizationId: props.organizationId }); break;
        case "portal": result = await openCustomerPortalAction({ organizationId: props.organizationId }); break;
        case "success_fee": result = await startSuccessFeeCardPaymentAction({ organizationId: props.organizationId, feeId: props.feeId }); break;
        case "scout_credits": result = await startScoutCreditPurchaseAction({ organizationId: props.organizationId, packageId: props.packageId }); break;
      }
      if (!result.success) { setError(result.error); return; }
      if (!isAllowedStripeRedirect(result.url)) { setError("遷移先を確認できませんでした。時間をおいて再度お試しください。"); return; }
      window.location.assign(result.url);
    });
  }

  const cls = props.variant === "secondary"
    ? "border border-line bg-surface text-charcoal"
    : "bg-[#285B45] text-white";
  return (
    <div className="inline-block">
      <button type="button" onClick={go} disabled={pending}
        className={`rounded-full px-4 py-2 text-[12px] font-bold disabled:opacity-60 ${cls}`}>
        {pending ? "Stripeの画面を準備しています…" : props.label}
      </button>
      {error && <p role="alert" className="mt-1.5 max-w-[320px] rounded-lg bg-[#C24545]/10 px-3 py-2 text-[11.5px] text-[#8A2E2E]">{error}</p>}
    </div>
  );
}
