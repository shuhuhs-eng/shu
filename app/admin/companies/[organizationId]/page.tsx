import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAdminOrganizationOverview, getAdminOrganizationStores, getAdminSuccessFees, getBillingIntegrityIssues } from "@/lib/billing/actions";
import { feeStatusLabel, formatYen } from "@/lib/billing/format";
import { issueTypeLabel, severityLabel } from "@/lib/billing/integrity";
import { ExportCsvButton } from "@/components/analytics/export-csv-button";

type Props = { params: Promise<{ organizationId: string }> };

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });
}

/**
 * 運営者向けの会社詳細（/admin/companies/[organizationId]、Phase 21）。読み取り専用。
 * ★運営者のみ。既存の全社サマリー・成功報酬一覧・整合性チェックの結果を、この会社で絞って表示する。
 * ★各店舗の画面（採用進捗の詳細など）へは運営者の権限では入れないため、リンクは作らない。
 */
export default async function AdminCompanyDetailPage({ params }: Props) {
  const { organizationId } = await params;
  if (!z.string().uuid().safeParse(organizationId).success) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/admin/companies/${organizationId}`);
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) redirect("/mypage");

  const [orgs, stores, allFees, allIssues] = await Promise.all([
    getAdminOrganizationOverview(),
    getAdminOrganizationStores(organizationId),
    getAdminSuccessFees(),
    getBillingIntegrityIssues(),
  ]);
  if (orgs === null) throw new Error("会社の情報を取得できませんでした。");
  const org = orgs.find((o) => o.organization_id === organizationId);
  if (!org) notFound();

  const fees = allFees ? allFees.filter((f) => f.organization_id === organizationId) : null;
  const issues = allIssues ? allIssues.filter((i) => i.organization_id === organizationId) : null;

  return (
    <main className="mx-auto max-w-[760px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach Admin</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <Link href="/admin/companies" className="text-[13px] font-semibold text-sub underline">← 会社一覧</Link>
      <h1 className="mt-4 font-serif text-2xl font-bold text-ink">{org.organization_name}</h1>

      <section className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-6">
        {[
          ["店舗数", org.store_count], ["利用中店舗", org.active_store_count], ["候補者", org.candidate_count],
          ["面談到達", org.interview_count], ["内定", org.offered_count], ["採用", org.hired_count],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-line bg-surface p-3">
            <p className="text-[11px] text-sub">{label}</p><p className="mt-1 font-serif text-[22px] font-bold text-ink">{value}</p>
          </div>
        ))}
      </section>
      <p className="mt-3 text-[11.5px] text-sub">整合性の異常：{issues === null ? "取得できませんでした" : `${issues.length}件`} ／ 直近採用日 {fmtDate(org.latest_hired_at)} ／ 直近活動日 {fmtDate(org.latest_activity_at)}</p>

      <section className="mt-8">
        <p className="eyebrow mb-3">店舗一覧</p>
        {stores === null ? (
          <p className="rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">店舗の情報を取得できませんでした。</p>
        ) : stores.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface p-6 text-center text-[13px] text-sub">店舗はまだ登録されていません。</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
              <table className="w-full min-w-[640px] text-[12px]">
                <thead><tr className="border-b border-line text-left text-sub">
                  <th className="px-3 py-2.5 font-semibold">店舗</th><th className="px-2 py-2.5 text-center font-semibold">利用状況</th>
                  <th className="px-2 py-2.5 text-center font-semibold">登録日</th><th className="px-2 py-2.5 text-center font-semibold">候補者</th>
                  <th className="px-2 py-2.5 text-center font-semibold">進行中</th><th className="px-2 py-2.5 text-center font-semibold">採用</th>
                  <th className="px-2 py-2.5 text-center font-semibold">直近活動日</th>
                </tr></thead>
                <tbody>
                  {stores.map((s) => (
                    <tr key={s.store_id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2.5 font-semibold text-ink">{s.store_name}</td>
                      <td className="px-2 py-2.5 text-center">{s.usage_status === "active" ? "利用中" : "未利用"}</td>
                      <td className="px-2 py-2.5 text-center">{fmtDate(s.created_at)}</td>
                      <td className="px-2 py-2.5 text-center">{s.candidate_count}</td>
                      <td className="px-2 py-2.5 text-center">{s.active_candidate_count}</td>
                      <td className="px-2 py-2.5 text-center">{s.hired_count}</td>
                      <td className="px-2 py-2.5 text-center">{fmtDate(s.latest_activity_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3">
              <ExportCsvButton
                filename="stores.csv"
                header={["店舗", "利用状況", "登録日", "候補者", "進行中", "採用", "直近活動日"]}
                rows={stores.map((s) => [s.store_name, s.usage_status === "active" ? "利用中" : "未利用", fmtDate(s.created_at), s.candidate_count, s.active_candidate_count, s.hired_count, fmtDate(s.latest_activity_at)])}
              />
            </div>
          </>
        )}
      </section>

      <section className="mt-8">
        <p className="eyebrow mb-3">請求の状況</p>
        <dl className="grid grid-cols-3 gap-2 text-[11px] sm:grid-cols-4">
          {[
            ["成功報酬", org.success_fee_count], ["請求確認中", org.pending_confirmation_count], ["請求額確定", org.confirmed_count],
            ["請求済み", org.invoiced_count], ["入金済み", org.paid_count], ["免除", org.waived_count], ["取消", org.cancelled_count],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-surface2 p-2"><dt className="text-sub">{label}</dt><dd className="mt-0.5 text-[15px] font-bold text-ink">{value}</dd></div>
          ))}
        </dl>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
          <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">成功報酬総額</dt><dd className="mt-0.5 text-[13px] font-bold">{formatYen(org.confirmed_total_amount)}</dd></div>
          <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">請求済み総額</dt><dd className="mt-0.5 text-[13px] font-bold">{formatYen(org.invoiced_total_amount)}</dd></div>
          <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">入金済み総額</dt><dd className="mt-0.5 text-[13px] font-bold">{formatYen(org.paid_total_amount)}</dd></div>
        </dl>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between"><p className="eyebrow">成功報酬の一覧</p><Link href="/admin/success-fees" className="text-[12px] font-semibold underline">金額の確定・請求の操作 ›</Link></div>
        {fees === null ? (
          <p className="rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">成功報酬を取得できませんでした。</p>
        ) : fees.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface p-6 text-center text-[13px] text-sub">成功報酬の記録はまだありません。</p>
        ) : (
          <div className="space-y-2">
            <ExportCsvButton
              filename="success-fees.csv"
              label="成功報酬をCSVで保存（個人名なし）"
              header={["店舗", "採用成立日", "状態", "成功報酬", "税", "合計"]}
              rows={fees.map((f) => [f.store_name, fmtDate(f.hired_at), feeStatusLabel(f.fee_status), f.fee_amount, f.tax_amount, f.total_amount])}
            />
            {fees.map((f) => (
              <div key={f.fee_id} className="rounded-2xl border border-line bg-surface p-4 text-[12px]">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-[11px] text-sub">{f.store_name} ／ 採用成立日 {fmtDate(f.hired_at)}</p><p className="mt-0.5 font-serif text-[15px] font-bold text-ink">{f.stylist_name ?? "美容師"}</p></div>
                  <span className="shrink-0 rounded-full bg-surface2 px-3 py-1 text-[11px] font-semibold text-sub">{feeStatusLabel(f.fee_status)}</span>
                </div>
                <p className="mt-2 text-charcoal">成功報酬 {formatYen(f.fee_amount)} ／ 税 {formatYen(f.tax_amount)} ／ 合計 {formatYen(f.total_amount)}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between"><p className="eyebrow">整合性チェック</p><Link href="/admin/integrity" className="text-[12px] font-semibold underline">すべて見る ›</Link></div>
        {issues === null ? (
          <p className="rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">チェック結果を取得できませんでした。</p>
        ) : issues.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface p-6 text-center text-[13px] text-charcoal">問題は検出されていません</p>
        ) : (
          <div className="space-y-2">
            {issues.map((i, idx) => (
              <div key={`${i.hiring_process_id}-${i.issue_type}-${idx}`} className="rounded-2xl border border-line bg-surface p-4 text-[12px]">
                <p className="font-semibold text-ink">{issueTypeLabel(i.issue_type)}（{severityLabel(i.severity)}）</p>
                <p className="mt-1 text-charcoal">{i.store_name ?? "店舗"} ／ {i.stylist_name ?? "—"} ／ {i.message}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
