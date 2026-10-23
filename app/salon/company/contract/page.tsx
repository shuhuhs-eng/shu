import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { canViewCompanyBilling } from "@/lib/billing/permissions";
import { getCompanyContractSettings } from "@/lib/contracts/actions";
import { contractStatusLabel, formatContractDate, monthLabel, successFeeModeLabel, yenOrUnset } from "@/lib/contracts/format";

/**
 * 契約内容（/salon/company/contract）。完全read-only。
 *
 * ★入れる人: company_owner / company_admin のみ（middleware・このページ・RPCの3層）。
 * ★運営者用メモ・変更履歴・操作者のIDは取得もしない（RPCが返さない）。
 * ★契約内容を会社側から変更することはできない（操作UIも作らない）。
 */
export default async function CompanyContractPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/salon/company/contract");
  if (!(await hasCompletedRole(supabase, user.id, "salon"))) redirect("/onboarding/salon");
  if (!(await canViewCompanyBilling(supabase, user.id))) redirect("/salon/company");

  const contracts = await getCompanyContractSettings();

  return (
    <main className="mx-auto max-w-[760px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <Link href="/salon/company" className="text-[13px] font-semibold text-sub underline">← 会社ダッシュボードに戻る</Link>
      <p className="eyebrow mb-2 mt-5">契約内容</p>
      <h1 className="font-serif text-2xl font-bold text-ink">ご契約の内容</h1>
      <p className="mt-3 text-[13px] leading-relaxed text-charcoal">
        現在の契約条件です。内容の変更は運営にお問い合わせください。この画面から変更することはできません。
      </p>

      {contracts === null ? (
        <p className="mt-6 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">契約情報を取得できませんでした。時間をおいて再度お試しください。</p>
      ) : contracts.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-line bg-surface p-8 text-center text-[13px] text-sub">表示できる契約情報がありません。</p>
      ) : (
        <div className="mt-6 space-y-4">
          {contracts.map((c) => (
            <article key={c.organization_id} className="rounded-2xl border border-line bg-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-serif text-[16px] font-bold text-ink">{c.organization_name}</h2>
                <span className="shrink-0 rounded-full bg-surface2 px-3 py-1 text-[11px] font-semibold text-sub">{contractStatusLabel(c.contract_status)}</span>
              </div>
              {!c.has_contract ? (
                <p className="mt-3 text-[12px] text-charcoal">契約条件はまだ登録されていません。年度開始月：{monthLabel(c.fiscal_year_start_month)}</p>
              ) : (
                <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
                  <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">成功報酬方式</dt><dd className="mt-0.5 text-[13px] font-bold">{successFeeModeLabel(c.success_fee_mode)}</dd></div>
                  <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">成功報酬の基準額</dt><dd className="mt-0.5 text-[13px] font-bold">{yenOrUnset(c.success_fee_amount)}</dd></div>
                  <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">月額</dt><dd className="mt-0.5 text-[13px] font-bold">{yenOrUnset(c.monthly_fee)}</dd></div>
                  <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">契約開始日</dt><dd className="mt-0.5 text-[13px] font-bold">{formatContractDate(c.contract_started_at)}</dd></div>
                  <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">契約終了日</dt><dd className="mt-0.5 text-[13px] font-bold">{formatContractDate(c.contract_ended_at)}</dd></div>
                  <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">年度開始月</dt><dd className="mt-0.5 text-[13px] font-bold">{monthLabel(c.fiscal_year_start_month)}</dd></div>
                </dl>
              )}
              <p className="mt-3 text-[11px] leading-relaxed text-sub">
                成功報酬の基準額は、採用が成立した時点の金額が記録されます。実際の請求額は運営が確認のうえ確定します。
              </p>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
