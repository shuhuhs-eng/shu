import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminOrganizationOverview, getAdminSuccessFees, getBillingIntegrityIssues } from "@/lib/billing/actions";
import { formatYen } from "@/lib/billing/format";
import { countSeverities } from "@/lib/billing/integrity";
import { summarizeFees } from "@/lib/billing/summary";
import { countPaymentStates } from "@/lib/billing/payment";
import { getAdminInvoiceDocuments } from "@/lib/invoices/actions";
import { getAdminOrganizationContracts } from "@/lib/contracts/actions";

/**
 * 運営ダッシュボード（/admin）。採用成立と成功報酬の状況を集計する。
 * ★運営者(is_platform_admin)以外は入れない。集計は get_admin_success_fees の結果から
 * アプリ側で行う（件数が大きく増えた場合は専用の集計RPCを検討する）。
 */
export default async function AdminDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) redirect("/mypage");

  const [fees, issues, orgs, contracts, documents] = await Promise.all([
    getAdminSuccessFees(),
    getBillingIntegrityIssues(),
    getAdminOrganizationOverview(),
    getAdminOrganizationContracts(),
    getAdminInvoiceDocuments(),
  ]);
  // 契約まわりの「要確認」の件数（異常と断定するものではなく、確認の目安）。
  const contractChecks = contracts
    ? [
        { label: "契約条件が未設定の会社", value: contracts.filter((o) => o.contract === null).length, href: "/admin/contracts?filter=unset" },
        { label: "試用中の会社", value: contracts.filter((o) => o.contract?.contract_status === "trial").length, href: "/admin/contracts?filter=trial" },
        { label: "一時停止の会社", value: contracts.filter((o) => o.contract?.contract_status === "suspended").length, href: "/admin/contracts?filter=suspended" },
        { label: "解約の会社", value: contracts.filter((o) => o.contract?.contract_status === "cancelled").length, href: "/admin/contracts?filter=cancelled" },
        { label: "成功報酬額が未設定の契約", value: contracts.filter((o) => o.contract !== null && o.contract.success_fee_amount === null).length, href: "/admin/contracts?filter=no_amount" },
        ...(fees
          ? [{
              label: "基準額と請求額が異なる成功報酬",
              value: fees.filter((f) => f.contract_success_fee_amount !== null && f.fee_amount !== null && f.fee_amount !== f.contract_success_fee_amount).length,
              href: "/admin/success-fees?view=diff",
            }]
          : []),
      ]
    : null;
  const orgTotals = orgs
    ? {
        companies: orgs.length,
        stores: orgs.reduce((n, o) => n + o.store_count, 0),
        hired: orgs.reduce((n, o) => n + o.hired_count, 0),
      }
    : null;
  const integrity = issues ? countSeverities(issues) : null;
  const summary = fees ? summarizeFees(fees) : null;

  const payStates = fees ? countPaymentStates(fees) : null;
  // 発行済みの請求書PDFが無い、0045以降の請求（旧請求データは対象外）。取得できなければ判断しない。
  const withoutPdf = fees && documents
    ? (() => {
        const issued = new Set(documents.map((d) => d.success_fee_id));
        return fees.filter((f) => (f.fee_status === "invoiced" || f.fee_status === "paid") && f.invoice_number !== null && !issued.has(f.fee_id)).length;
      })()
    : null;
  const daily: Array<{ label: string; value: number; href: string; alert?: boolean }> | null =
    summary && payStates && integrity && withoutPdf !== null
      ? [
          { label: "成功報酬の確認待ち", value: summary.counts.pending_confirmation, href: "/admin/success-fees?view=pre_invoice" },
          { label: "請求待ち（金額確定済み）", value: summary.counts.confirmed, href: "/admin/success-fees?view=pre_invoice" },
          { label: "請求書PDFが未発行", value: withoutPdf, href: "/admin/success-fees" },
          { label: "未入金", value: payStates.unpaid + payStates.overdue, href: "/admin/success-fees?view=unpaid" },
          { label: "支払期限超過", value: payStates.overdue, href: "/admin/success-fees?view=overdue", alert: true },
          { label: "整合性の異常", value: integrity.total, href: "/admin/integrity", alert: true },
          ...(contracts
            ? [{ label: "契約が停止中の会社", value: contracts.filter((o) => o.contract?.contract_status === "suspended").length, href: "/admin/contracts?filter=suspended" }]
            : []),
          { label: "採用成立（累計）", value: summary.hiredCount, href: "/admin/success-fees" },
        ]
      : null;

  const countCards: Array<{ label: string; value: number }> = summary
    ? [
        { label: "採用成立", value: summary.hiredCount },
        { label: "請求確認中", value: summary.counts.pending_confirmation },
        { label: "請求額確定", value: summary.counts.confirmed },
        { label: "請求済み", value: summary.counts.invoiced },
        { label: "入金済み", value: summary.counts.paid },
        { label: "免除", value: summary.counts.waived },
        { label: "取消", value: summary.counts.cancelled },
      ]
    : [];
  const amountCards: Array<{ label: string; value: string; note: string }> = summary
    ? [
        { label: "成功報酬総額", value: formatYen(summary.confirmedTotal), note: "金額確定以降（免除・取消を除く）の合計" },
        { label: "請求済み総額", value: formatYen(summary.invoicedTotal), note: "請求済み＋入金済みの合計" },
        { label: "入金済み総額", value: formatYen(summary.paidTotal), note: "入金済みの合計" },
      ]
    : [];

  return (
    <main className="mx-auto max-w-[760px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach Admin</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <h1 className="font-serif text-2xl font-bold text-ink">運営ダッシュボード</h1>
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">採用成立と成功報酬の状況です。</p>

      {summary === null ? (
        <p className="mt-6 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">成功報酬の情報を取得できませんでした。時間をおいて再度お試しください。</p>
      ) : (
        <>
          <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {countCards.map((c) => (
              <div key={c.label} className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-[11px] text-sub">{c.label}</p>
                <p className="mt-1 font-serif text-[26px] font-bold text-ink">{c.value}</p>
              </div>
            ))}
          </section>
          <section className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {amountCards.map((c) => (
              <div key={c.label} className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-[11px] text-sub">{c.label}</p>
                <p className="mt-1 font-serif text-[20px] font-bold text-ink">{c.value}</p>
                <p className="mt-1 text-[10px] text-sub">{c.note}</p>
              </div>
            ))}
          </section>
        </>
      )}

      <section className="mt-8">
        <p className="eyebrow mb-1">毎日の確認</p>
        <p className="mb-3 text-[11.5px] leading-relaxed text-sub">対応が必要な件数です。押すと該当の一覧へ移動します。</p>
        {daily === null ? (
          <p className="rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">確認に必要な情報を取得できませんでした。時間をおいて再度お試しください。</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {daily.map((m) => (
              <Link key={m.label} href={m.href}
                className={`rounded-2xl border p-4 ${m.alert && m.value > 0 ? "border-[#C24545]/40 bg-[#C24545]/5" : "border-line bg-surface"}`}>
                <p className="text-[11px] text-sub">{m.label}</p>
                <p className={`mt-1 font-serif text-[22px] font-bold ${m.alert && m.value > 0 ? "text-[#8A2E2E]" : "text-ink"}`}>{m.value}件</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-1 flex items-center justify-between">
          <p className="eyebrow">契約の確認</p>
          <Link href="/admin/contracts" className="text-[12px] font-semibold underline">契約一覧 ›</Link>
        </div>
        <p className="mb-3 text-[11.5px] leading-relaxed text-sub">異常ではなく、確認の目安となる件数です。</p>
        {contractChecks === null ? (
          <p className="rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">契約の情報を取得できませんでした。</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {contractChecks.map((m) => (
              <Link key={m.label} href={m.href} className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-[11px] text-sub">{m.label}</p>
                <p className="mt-1 font-serif text-[22px] font-bold text-ink">{m.value}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <Link href="/admin/companies" className="mt-8 block rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <span className="font-serif text-[15px] font-bold text-ink">会社一覧</span>
          <span className="text-[12px] text-sub">会社ごとの採用と請求 ›</span>
        </div>
        {orgTotals === null ? (
          <p className="mt-2 text-[12px] text-[#8A2E2E]">会社の情報を取得できませんでした。</p>
        ) : (
          <p className="mt-2 text-[12px] text-charcoal">会社 {orgTotals.companies}社 ／ 店舗 {orgTotals.stores}店 ／ 採用 {orgTotals.hired}名</p>
        )}
      </Link>

      <Link href="/admin/integrity" className="mt-3 block rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <span className="font-serif text-[15px] font-bold text-ink">整合性チェック</span>
          <span className="text-[12px] text-sub">採用と成功報酬の突き合わせ ›</span>
        </div>
        {integrity === null ? (
          <p className="mt-2 text-[12px] text-[#8A2E2E]">チェック結果を取得できませんでした。</p>
        ) : integrity.total === 0 ? (
          <p className="mt-2 text-[12px] text-charcoal">問題は検出されていません</p>
        ) : (
          <p className="mt-2 text-[12px] text-charcoal">
            要対応 <strong className="text-[#8A2E2E]">{integrity.critical}</strong>件 ／ 要確認 <strong>{integrity.warning}</strong>件
          </p>
        )}
      </Link>

      <div className="mt-3 space-y-3">
        <Link href="/admin/success-fees" className="flex items-center justify-between rounded-2xl border border-line bg-surface p-5">
          <span className="font-serif text-[15px] font-bold text-ink">成功報酬の管理</span><span className="text-[12px] text-sub">金額確定・請求・入金 ›</span>
        </Link>
        <Link href="/admin/evidence" className="flex items-center justify-between rounded-2xl border border-line bg-surface p-5">
          <span className="font-serif text-[15px] font-bold text-ink">実績資料の確認</span><span className="text-[12px] text-sub">提出資料の審査 ›</span>
        </Link>
      </div>
    </main>
  );
}
