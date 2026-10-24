import Link from "next/link";
import { redirect } from "next/navigation";
import { CompanyBillingNav } from "@/components/billing/company-billing-nav";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { canViewCompanyBilling } from "@/lib/billing/permissions";
import { getCompanySuccessFees } from "@/lib/billing/actions";
import { getCompanyInvoiceDocuments } from "@/lib/invoices/actions";
import { feeStatusLabel, formatYen } from "@/lib/billing/format";
import { countPaymentStates, overdueDays, paymentState, PAYMENT_STATE_CLASSES, PAYMENT_STATE_LABELS } from "@/lib/billing/payment";
import { summarizeFees } from "@/lib/billing/summary";
import { BaselineSummary } from "@/components/contracts/baseline-summary";
import { InvoiceSummary } from "@/components/billing/invoice-summary";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });
}

/**
 * 請求・成功報酬（/salon/company/billing、Phase 12）。完全read-only。
 *
 * ★入れる人: company_owner / company_admin のみ。recruiting_admin以下は
 * /salon/company へ戻す（middlewareとこのページの両方で守る。DBのRPCも同じ制限）。
 * ★運営者メモは取得もしない（RPCが返さない）。金額が未確定(null)の場合は0円ではなく「未確定」。
 * ★会社側からの金額変更・状態変更・免除・取消はできない（操作UIも作らない）。
 */
export default async function CompanyBillingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/salon/company/billing");
  if (!(await hasCompletedRole(supabase, user.id, "salon"))) redirect("/onboarding/salon");
  if (!(await canViewCompanyBilling(supabase, user.id))) redirect("/salon/company");

  const fees = await getCompanySuccessFees();
  const summary = fees ? summarizeFees(fees) : null;
  // 入金状況は請求済み＋支払期限から導出（保存はしない）。
  const pay = fees ? countPaymentStates(fees) : null;
  // 発行済みの請求書PDF（保存先・hashは返らない）。取得できない場合は案内だけ出す。
  const documents = await getCompanyInvoiceDocuments();
  const documentByFee = new Map((documents ?? []).map((d) => [d.success_fee_id, d.document_id]));

  return (
    <main className="mx-auto max-w-[760px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <Link href="/salon/company" className="text-[13px] font-semibold text-sub underline">← 会社ダッシュボードに戻る</Link>
      <CompanyBillingNav current="/salon/company/billing" />
      <p className="eyebrow mb-2 mt-5">請求・成功報酬</p>
      <h1 className="font-serif text-2xl font-bold text-ink">採用に伴う請求の状況</h1>
      <p className="mt-3 text-[13px] leading-relaxed text-charcoal">
        採用が成立した件ごとの請求状況です。内容は運営が確認のうえ確定します。この画面から内容を変更することはできません。
      </p>


      {fees === null || summary === null ? (
        <p className="mt-6 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">請求情報を取得できませんでした。時間をおいて再度お試しください。</p>
      ) : fees.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-line bg-surface p-8 text-center text-[13px] text-sub">採用が成立した件はまだありません。</p>
      ) : (
        <>
          <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: "請求確認中", value: summary.counts.pending_confirmation },
              { label: "請求額確定", value: summary.counts.confirmed },
              { label: "未入金", value: pay ? pay.unpaid : 0 },
              { label: "支払期限超過", value: pay ? pay.overdue : 0 },
              { label: "入金済み", value: summary.counts.paid },
            ].map((c) => (
              <div key={c.label} className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-[11px] text-sub">{c.label}</p>
                <p className="mt-1 font-serif text-[26px] font-bold text-ink">{c.value}</p>
              </div>
            ))}
          </section>

          <div className="mt-8 space-y-3">
            <p className="text-[11.5px] leading-relaxed text-sub">
              「契約基準額」は採用が成立した時点の契約上の金額で、「実際の請求額」とは別に表示しています。契約基準額が「未記録」の件は、記録を始める前に成立した採用です。
            </p>
            {fees.map((f) => (
              <article key={f.fee_id} className="rounded-2xl border border-line bg-surface p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] text-sub">{f.store_name} ／ 採用成立日 {fmtDate(f.hired_at)}</p>
                    <h2 className="mt-1 font-serif text-[16px] font-bold text-ink">{f.stylist_name ?? "美容師"}</h2>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-full bg-surface2 px-3 py-1 text-[11px] font-semibold text-sub">{feeStatusLabel(f.fee_status)}</span>
                    {["unpaid", "overdue", "paid"].includes(paymentState(f)) && (
                      <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${PAYMENT_STATE_CLASSES[paymentState(f)]}`}>
                        {PAYMENT_STATE_LABELS[paymentState(f)]}{paymentState(f) === "overdue" ? `（${overdueDays(f.due_date)}日）` : ""}
                      </span>
                    )}
                  </div>
                </div>
                {f.fee_status === "pending_confirmation" && (
                  <p className="mt-3 text-[12px] text-charcoal">請求内容を確認中です。</p>
                )}
                <BaselineSummary
                  baseline={f.contract_success_fee_amount}
                  statusSnapshot={f.contract_status_snapshot}
                  feeAmount={f.fee_amount}
                  taxAmount={f.tax_amount}
                  totalAmount={f.total_amount}
                />
                <InvoiceSummary
                  feeStatus={f.fee_status}
                  invoiceNumber={f.invoice_number}
                  invoicedAt={f.invoiced_at}
                  dueDate={f.due_date}
                  taxRate={f.tax_rate}
                  feeAmount={f.fee_amount}
                  taxAmount={f.tax_amount}
                  totalAmount={f.total_amount}
                />
                {/* 0045以降に請求された請求書だけ。旧請求データ（番号なし）にはPDFの表示を出さない。 */}
                {(f.fee_status === "invoiced" || f.fee_status === "paid") && f.invoice_number !== null && (
                  documentByFee.has(f.fee_id) ? (
                    <p className="mt-3">
                      <a href={`/api/invoices/${documentByFee.get(f.fee_id)}/pdf?download=1`}
                        className="inline-block rounded-full bg-[#285B45] px-4 py-2 text-[12px] font-bold text-white">請求書PDFをダウンロード</a>
                    </p>
                  ) : (
                    <p className="mt-3 text-[11.5px] text-sub">請求書PDFは準備中です。発行されるとここからダウンロードできます。</p>
                  )
                )}
                <dl className="mt-3 grid grid-cols-3 gap-2 text-[10.5px] text-sub">
                  <div><dt>請求確定日</dt><dd className="text-charcoal">{fmtDate(f.confirmed_at)}</dd></div>
                  <div><dt>請求日</dt><dd className="text-charcoal">{fmtDate(f.invoiced_at)}</dd></div>
                  <div><dt>入金日</dt><dd className="text-charcoal">{fmtDate(f.paid_at)}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
