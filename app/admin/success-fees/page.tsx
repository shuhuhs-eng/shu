import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminSuccessFees } from "@/lib/billing/actions";
import { countPaymentStates, paymentState } from "@/lib/billing/payment";
import { getAdminInvoiceDocuments } from "@/lib/invoices/actions";
import { SuccessFeeCard } from "@/components/admin/success-fee-card";

/**
 * 運営者向けの成功報酬管理（/admin/success-fees）。
 * ★運営者(is_platform_admin)以外は入れない。RPCも運営者以外を拒否する。
 */
type Props = { searchParams: Promise<{ view?: string }> };

export default async function AdminSuccessFeesPage({ searchParams }: Props) {
  const { view } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/success-fees");
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) redirect("/mypage");

  const fees = await getAdminSuccessFees();
  if (fees === null) throw new Error("成功報酬の一覧を取得できませんでした。");
  // 発行済みの請求書PDF（取得できなかった場合は発行済みを判別できないため、操作を出さずに案内する）。
  const documents = await getAdminInvoiceDocuments();
  const documentByFee = new Map((documents ?? []).map((d) => [d.success_fee_id, d.document_id]));

  // 絞り込み。入金状況（請求前／未入金／期限超過／入金済み）は、請求済み＋支払期限から導出する（DBには保存しない）。
  const pay = countPaymentStates(fees);
  const scoped =
    view === "diff"
      ? fees.filter((f) => f.contract_success_fee_amount !== null && f.fee_amount !== null && f.fee_amount !== f.contract_success_fee_amount)
      : view === "unrecorded"
        ? fees.filter((f) => f.contract_success_fee_amount === null)
        : view === "pre_invoice" || view === "unpaid" || view === "overdue" || view === "paid"
          ? fees.filter((f) => {
              const st = paymentState(f);
              // 「未入金」は期限超過も含める（期限内の未入金＋期限超過）。
              return view === "unpaid" ? st === "unpaid" || st === "overdue" : st === view;
            })
          : fees;
  const open = scoped.filter((f) => ["pending_confirmation", "confirmed", "invoiced"].includes(f.fee_status));
  const closed = scoped.filter((f) => !open.includes(f));

  return (
    <main className="mx-auto max-w-[760px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach Admin</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <Link href="/admin" className="text-[13px] font-semibold text-sub underline">← 運営ダッシュボード</Link>
      <h1 className="mt-4 font-serif text-2xl font-bold text-ink">成功報酬の管理</h1>
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">
        採用が成立すると自動で「請求確認中」の記録ができます。金額・税額は契約内容に従って入力してください（整数円）。免除・取消には理由が必要です。請求済みの請求書は、ここから請求書PDFを発行できます（決済は行いません）。
      </p>

      {documents === null && (
        <p className="mt-4 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">発行済みの請求書を取得できませんでした。請求書PDFの発行は、画面を更新してから行ってください。</p>
      )}
      <p className="mt-3 text-[12px]"><Link href="/admin/issuer-settings" className="font-semibold text-ink underline">請求書の発行事業者・振込先を設定する</Link></p>

      <nav className="mt-4 flex flex-wrap gap-2" aria-label="絞り込み">
        {[
          { key: "all", label: "すべて", href: "/admin/success-fees" },
          { key: "pre_invoice", label: `請求前（${pay.pre_invoice}）`, href: "/admin/success-fees?view=pre_invoice" },
          { key: "unpaid", label: `未入金（${pay.unpaid + pay.overdue}）`, href: "/admin/success-fees?view=unpaid" },
          { key: "overdue", label: `支払期限超過（${pay.overdue}）`, href: "/admin/success-fees?view=overdue" },
          { key: "paid", label: `入金済み（${pay.paid}）`, href: "/admin/success-fees?view=paid" },
          { key: "diff", label: "基準額と請求額が異なる", href: "/admin/success-fees?view=diff" },
          { key: "unrecorded", label: "契約基準額が未記録", href: "/admin/success-fees?view=unrecorded" },
        ].map((f) => (
          <Link key={f.key} href={f.href}
            className={`rounded-full border px-3.5 py-1.5 text-[12px] font-semibold ${(view ?? "all") === f.key ? "border-ink bg-ink text-white" : "border-line bg-surface text-charcoal"}`}>
            {f.label}
          </Link>
        ))}
      </nav>

      <h2 className="mt-8 font-serif text-base font-bold text-ink">対応が必要・進行中（{open.length}件）</h2>
      <div className="mt-3 space-y-5">
        {open.length > 0 ? open.map((f) => <SuccessFeeCard key={f.fee_id} fee={f} documentId={documentByFee.get(f.fee_id) ?? null} />) : <p className="rounded-2xl border border-line bg-surface p-8 text-center text-[13px] text-sub">対応が必要な成功報酬はありません。</p>}
      </div>

      {closed.length > 0 && (
        <>
          <h2 className="mt-10 font-serif text-base font-bold text-ink">完了・終了（{closed.length}件）</h2>
          <div className="mt-3 space-y-5">{closed.map((f) => <SuccessFeeCard key={f.fee_id} fee={f} documentId={documentByFee.get(f.fee_id) ?? null} />)}</div>
        </>
      )}
    </main>
  );
}
