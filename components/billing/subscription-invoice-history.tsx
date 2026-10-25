import type { CompanySubscriptionInvoice } from "@/types/database";
import { COMPANY_INVOICE_TEXT, companyInvoiceState } from "@/lib/invoices/subscription-status";

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const fmt = (iso: string) => new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });
/** period_end は翌期の開始のため、表示上の終了日は前日。 */
const endDisplay = (iso: string) => fmt(new Date(new Date(iso).getTime() - 24 * 60 * 60 * 1000).toISOString());

/**
 * 月額のお支払い履歴（会社向け）。適格請求書の正本はBeauty Reachが発行するPDF。
 * ★発行条件の不足などの内部事情は出さない（「準備しています」とだけ伝える）。Stripe参照・保存先も出さない。
 */
export function SubscriptionInvoiceHistory({ invoices }: { invoices: CompanySubscriptionInvoice[] | null }) {
  const now = new Date();
  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-5" aria-labelledby="sub-invoice-heading">
      <h3 id="sub-invoice-heading" className="text-[13px] font-bold text-ink">月額のお支払い履歴</h3>
      <p className="mt-1 text-[11.5px] leading-relaxed text-sub">
        月額利用料のカード決済ごとに、Beauty Reachが適格請求書（クレジットカード決済済み）を発行します。
      </p>
      {invoices === null ? (
        <p className="mt-3 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">お支払い履歴を取得できませんでした。時間をおいて再度お試しください。</p>
      ) : invoices.length === 0 ? (
        <p className="mt-3 text-[13px] text-sub">まだ月額のお支払いはありません。</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {invoices.map((inv) => {
            const state = companyInvoiceState(inv.document_id !== null, inv.paid_at, now);
            return (
              <li key={inv.payment_id} className="rounded-xl bg-surface2 px-4 py-3 text-[12.5px] text-charcoal">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-ink">対象期間　{fmt(inv.period_start)} 〜 {endDisplay(inv.period_end)}</p>
                  <span className="rounded-full bg-[#285B45]/10 px-2.5 py-0.5 text-[11px] font-bold text-[#285B45]">カード決済済み</span>
                </div>
                <dl className="mt-2 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                  <div className="flex justify-between gap-3"><dt className="text-sub">支払日</dt><dd>{fmt(inv.paid_at)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-sub">税抜金額</dt><dd>{yen(inv.amount_excl_tax)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-sub">税率</dt><dd>{inv.tax_rate}%</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-sub">消費税</dt><dd>{yen(inv.tax_amount)}</dd></div>
                  <div className="flex justify-between gap-3 font-bold sm:col-span-2"><dt>合計（税込）</dt><dd>{yen(inv.total_amount)}</dd></div>
                </dl>
                <p className="mt-2 text-[12px]">
                  {state === "available" ? (
                    <a className="font-bold text-[#285B45] underline" href={`/api/subscription-invoices/${inv.document_id}/pdf?download=1`}>適格請求書をダウンロード（{inv.invoice_number}）</a>
                  ) : (
                    <span className="text-sub">{COMPANY_INVOICE_TEXT[state]}</span>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
