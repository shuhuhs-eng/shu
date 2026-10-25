import type { CompanyPaymentOverview } from "@/types/database";
import type { CardDisplay } from "@/lib/stripe/checkout";
import { StripeStartButton } from "./stripe-start-button";
import { cardBrandLabel, formatCardExpiry, SUBSCRIPTION_STATE_CLASSES, subscriptionStateLabel, type SubscriptionPaymentState } from "@/lib/stripe/labels";

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });
}

/**
 * お支払い設定（カード登録・月額自動課金・追加スカウト枠）。company_owner / company_adminのみのページに置く。
 * ★表示するのはカードのブランド・下4桁・有効期限だけ（Stripeから表示のたびに取得。DBには保存しない）。
 * ★Stripe技術ID（cus_/sub_等）は一切表示しない。
 * ★Stripe Customer Portalは補助。Beauty Reachの請求書が主で、ポータルに行かなくても状況が分かる。
 */
export function PaymentSettings({ organizationId, overview, card, stripeReady }: {
  organizationId: string; overview: CompanyPaymentOverview | null; card: CardDisplay | null; stripeReady: boolean;
}) {
  if (overview === null) {
    return <p className="mt-6 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">お支払い設定を取得できませんでした。時間をおいて再度お試しください。</p>;
  }
  const sub = overview.subscription;
  const subState = sub?.payment_state as SubscriptionPaymentState | undefined;
  const subActive = !!sub && sub.payment_state !== "cancelled";

  return (
    <section className="mt-8 space-y-4" aria-label="お支払い設定">
      <h2 className="font-serif text-[18px] font-bold text-ink">お支払い設定</h2>
      {!stripeReady && (
        <p className="rounded-lg bg-surface2 px-3 py-2 text-[12px] text-sub">カード決済は現在準備中です。請求書記載の口座への銀行振込は引き続きご利用いただけます。</p>
      )}

      <article className="rounded-2xl border border-line bg-surface p-5">
        <h3 className="text-[13px] font-bold text-ink">お支払い方法（カード）</h3>
        {overview.payment_method_available ? (
          <p className="mt-2 text-[14px] text-charcoal">
            {card ? <>{cardBrandLabel(card.brand)} •••• {card.last4}　<span className="text-[12px] text-sub">有効期限 {formatCardExpiry(card.expMonth, card.expYear)}</span></> : "カードが登録されています"}
          </p>
        ) : (
          <p className="mt-2 text-[13px] text-sub">カードは登録されていません。</p>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-sub">カード番号は当社では保存せず、決済代行会社（Stripe）が安全に管理します。</p>
        {stripeReady && (
          <div className="mt-3 flex flex-wrap items-start gap-2">
            <StripeStartButton kind="card" organizationId={organizationId} label={overview.payment_method_available ? "カードを変更する" : "カードを登録する"} />
            {overview.has_payment_account && (
              <StripeStartButton kind="portal" organizationId={organizationId} label="Stripeでお支払い履歴を見る" variant="secondary" />
            )}
          </div>
        )}
      </article>

      <article className="rounded-2xl border border-line bg-surface p-5">
        <h3 className="text-[13px] font-bold text-ink">月額利用料金</h3>
        {overview.monthly_fee_state === "unset" && <p className="mt-2 text-[13px] text-sub">月額利用料金はまだ設定されていません。契約内容は運営が設定します。</p>}
        {overview.monthly_fee_state === "none" && <p className="mt-2 text-[13px] text-sub">月額利用料金はありません（0円）。カードの自動課金は不要です。</p>}
        {overview.monthly_fee_state === "set" && overview.monthly_fee !== null && (
          <dl className="mt-2 space-y-0.5 text-[13px] text-charcoal">
            <div className="flex justify-between gap-4 sm:max-w-xs"><dt>月額利用料（税抜）</dt><dd>{yen(overview.monthly_fee)}</dd></div>
            <div className="flex justify-between gap-4 sm:max-w-xs"><dt>消費税（{overview.monthly_tax_rate}%）</dt><dd>{overview.monthly_tax_amount === null ? "-" : yen(overview.monthly_tax_amount)}</dd></div>
            <div className="flex justify-between gap-4 border-t border-line pt-1 text-[14px] font-bold sm:max-w-xs"><dt>合計（税込）</dt><dd>{overview.monthly_total_amount === null ? "-" : yen(overview.monthly_total_amount)}</dd></div>
          </dl>
        )}
        {sub && subState && (
          <div className="mt-3 space-y-1 text-[12px] text-charcoal">
            <p><span className={`rounded-full px-3 py-1 text-[11px] font-bold ${SUBSCRIPTION_STATE_CLASSES[subState]}`}>{subscriptionStateLabel(sub.payment_state)}</span></p>
            {subActive && sub.current_period_end && <p>次回のお支払い予定日　{fmtDate(sub.current_period_end)}{sub.cancel_at_period_end ? "（この期間で終了します）" : ""}</p>}
            {sub.last_payment_at && <p className="text-sub">最後に成功したお支払い　{fmtDate(sub.last_payment_at)}</p>}
            {(sub.payment_state === "past_due" || sub.payment_state === "payment_failed") && (
              <p className="rounded-lg bg-[#B7791F]/10 px-3 py-2 text-[12px] text-[#8A5A12]">カードでのお支払いができていません。カードの有効期限や限度額をご確認のうえ、上のボタンからカードを変更してください。サービスは直ちには停止されません。</p>
            )}
            {sub.amount_excl_tax !== null && overview.monthly_fee !== null && sub.amount_excl_tax !== overview.monthly_fee && subActive && (
              <p className="text-[11.5px] text-sub">契約上の月額が変更されています。カード請求額の反映については運営からご案内します。</p>
            )}
          </div>
        )}
        {stripeReady && overview.subscription_startable && (
          <div className="mt-3">
            <StripeStartButton kind="subscription" organizationId={organizationId} label="月額をカードで自動課金する" />
            <p className="mt-1.5 text-[11px] text-sub">毎月、月額利用料に消費税を加えた合計（税込）がご登録のカードに自動で請求されます。</p>
          </div>
        )}
        {overview.monthly_fee_state === "set" && !overview.subscription_startable && !subActive && overview.contract_status !== "active" && (
          <p className="mt-3 text-[11.5px] text-sub">契約が有効になるとカードの自動課金を開始できます。</p>
        )}
      </article>

      <article className="rounded-2xl border border-line bg-surface p-5">
        <h3 className="text-[13px] font-bold text-ink">追加スカウト枠</h3>
        {overview.scout_credit_packages.length === 0 ? (
          <p className="mt-2 text-[13px] text-sub">追加スカウト枠は現在販売していません</p>
        ) : !overview.scout_credit_purchasable ? (
          <p className="mt-2 text-[13px] text-sub">契約が有効な間のみ購入できます。</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {overview.scout_credit_packages.map((p) => (
              <li key={p.package_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface2 px-4 py-3">
                <span className="text-[13px] text-charcoal">{p.label}　<span className="font-bold">{p.credits}件</span>　{yen(p.price_excl_tax)}（税抜）＋消費税 {yen(p.tax_amount)}＝<span className="font-bold">{yen(p.total_amount)}（税込）</span></span>
                {stripeReady && <StripeStartButton kind="scout_credits" organizationId={organizationId} packageId={p.package_id} label="カードで購入する" />}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-sub">決済が確認できてから枠が追加されます。</p>
      </article>
    </section>
  );
}
