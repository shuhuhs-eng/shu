import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin/guard";
import { manualBillingEnabled } from "@/lib/billing/hire-flags";
import { fmtJst } from "@/components/admin/operations-ui";
import { ManualInvoicePdfPanel } from "@/components/admin/manual-invoice-pdf-panel";
import { manualReadinessSchema } from "@/lib/invoices/manual-issue-flow";
import { missingLabels } from "@/lib/invoices/messages";
import { PaymentForm, ReverseButton, VoidButton } from "@/components/admin/manual-billing-forms";
import { KIND_LABELS, METHOD_LABELS, statusLabel, yen, type InvoiceDetail } from "@/lib/billing/manual-billing";

type Rpc = { rpc: (n: string, a: object) => Promise<{ data: unknown; error: unknown }> };

/** 運営（責任者のみ）: 請求の詳細（入金の記録・取消の履歴）。履歴は消せない（追記のみ）。 */
export default async function ManualInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await requireAdminPage(`/admin/manual-billing/${id}`);
  if (!manualBillingEnabled()) return <main className="mx-auto max-w-[900px] px-5 py-10"><p className="text-[12.5px] text-sub">この機能はまだ有効になっていません。</p></main>;
  const { data, error } = await (supabase as unknown as Rpc).rpc("admin_manual_invoice_get", { p_invoice_id: id });
  if (error) return <main className="mx-auto max-w-[900px] px-5 py-10"><p role="alert" className="text-[12.5px] text-[#8A2E2E]">請求を取得できませんでした。</p></main>;
  if (!data) notFound();
  const { invoice: v, payments } = data as InvoiceDetail;
  // 請求書PDF: 0121未適用ならRPCが無く unavailable 表示（他の機能は動く）。
  const pr = await (supabase as unknown as Rpc).rpc("admin_manual_invoice_pdf_readiness", { p_invoice_id: id });
  const pdf = pr.error ? null : manualReadinessSchema.safeParse(pr.data);
  const reversed = new Set(payments.filter((p) => p.reverses_id).map((p) => p.reverses_id));
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <Link href="/admin/manual-billing" className="text-[13px] font-semibold text-sub underline">← 手動請求・入金管理</Link>
      <h1 className="mt-4 font-serif text-2xl font-bold text-ink">{v.invoice_no}</h1>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12.5px]">
        <dt className="text-sub">会社</dt><dd>{v.organization_name}</dd><dt className="text-sub">種別</dt><dd>{KIND_LABELS[v.kind]}</dd>
        <dt className="text-sub">請求額（税込）</dt><dd>{yen(v.total_amount)}（本体 {yen(v.fee_amount)}＋消費税 {yen(v.tax_amount)}）</dd>
        <dt className="text-sub">入金済み／残額</dt><dd>{yen(v.paid_total)} ／ <b>{yen(v.outstanding)}</b></dd>
        <dt className="text-sub">支払期限</dt><dd>{v.due_on}</dd><dt className="text-sub">状態</dt><dd className={v.overdue ? "font-semibold text-[#8A2E2E]" : ""}>{statusLabel(v)}</dd>
        <dt className="text-sub">発行</dt><dd>{fmtJst(v.issued_at)}</dd>{v.void_reason && <><dt className="text-sub">取消の理由</dt><dd>{v.void_reason}</dd></>}
      </dl>
      <h2 className="mt-8 font-serif text-lg font-bold text-ink">請求書PDF</h2>
      <ManualInvoicePdfPanel invoiceId={v.id} status={v.status} documentId={pdf?.success ? (pdf.data.document_id ?? null) : null} missing={pdf?.success ? missingLabels(pdf.data.missing) : []} unavailable={!pdf?.success} />
      <h2 className="mt-8 font-serif text-lg font-bold text-ink">入金の履歴</h2>
      {payments.length === 0 ? <p className="mt-2 text-[12.5px] text-sub">入金の記録はまだありません。</p> : <ul className="mt-2 space-y-2">{payments.map((p) => (
        <li key={p.id} className="rounded-xl border border-line bg-surface p-3 text-[12.5px]">
          <p className={p.amount < 0 ? "font-semibold text-[#8A2E2E]" : "font-semibold"}>{p.entry_type === "payment" ? "入金" : "取消"}　{yen(Math.abs(p.amount))}　{p.received_on}　{METHOD_LABELS[p.method]}</p>
          <p className="mt-1 text-sub">{p.reference ?? ""}{p.note ? `（${p.note}）` : ""}　記録 {fmtJst(p.recorded_at)}</p>
          {p.entry_type === "payment" && !reversed.has(p.id) && v.status !== "void" && <p className="mt-1"><ReverseButton invoiceId={v.id} paymentId={p.id} /></p>}
        </li>))}</ul>}
      {v.status === "issued" && <><h2 className="mt-8 font-serif text-lg font-bold text-ink">入金を記録する</h2><PaymentForm invoiceId={v.id} outstanding={v.outstanding} />{v.paid_total === 0 && <VoidButton invoiceId={v.id} />}</>}
      <p className="mt-8 rounded-xl bg-surface2 p-3 text-[11.5px] leading-relaxed text-sub">請求額を超える入金・二重の記録は、自動では受け付けません。過入金や返金が必要な場合は、責任者が個別に確認して対応します（自動返金はしません）。</p>
    </main>
  );
}
