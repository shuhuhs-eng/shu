import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminOrganizationOverview, getBillingIntegrityIssues } from "@/lib/billing/actions";
import { CompanyList } from "@/components/admin/company-list";

/**
 * 運営者向けの会社一覧（/admin/companies、Phase 20）。読み取り専用。
 * ★運営者(is_platform_admin)のみ。get_admin_organization_overview（0041）を使う。
 * 採用の数字は現在の所属会社、請求の数字は採用成立時に固定した会社で集計されている。
 * 取得に失敗した場合は0件と表示しない。
 */
export default async function AdminCompaniesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/companies");
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) redirect("/mypage");

  const [orgs, issues] = await Promise.all([getAdminOrganizationOverview(), getBillingIntegrityIssues()]);
  // 整合性の異常を会社ごとに数える。取得に失敗した場合は null のまま（0件とは扱わない）。
  let issueCounts: Map<string, number> | null = null;
  if (issues !== null) {
    issueCounts = new Map();
    for (const i of issues) if (i.organization_id) issueCounts.set(i.organization_id, (issueCounts.get(i.organization_id) ?? 0) + 1);
  }

  return (
    <main className="mx-auto max-w-[900px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach Admin</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <Link href="/admin" className="text-[13px] font-semibold text-sub underline">← 運営ダッシュボード</Link>
      <h1 className="mt-4 font-serif text-2xl font-bold text-ink">会社一覧</h1>
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">
        会社ごとの店舗数、採用の進み具合、成功報酬の状況です。面談到達・内定数は、一度でもその段階に進んだ人数です。
      </p>

      {orgs === null ? (
        <p className="mt-6 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">会社の情報を取得できませんでした。時間をおいて再度お試しください。</p>
      ) : orgs.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-line bg-surface p-8 text-center text-[13px] text-sub">登録されている会社はありません。</p>
      ) : (
        <CompanyList companies={orgs.map((o) => ({ ...o, issue_count: issueCounts === null ? null : (issueCounts.get(o.organization_id) ?? 0) }))} />
      )}
    </main>
  );
}
