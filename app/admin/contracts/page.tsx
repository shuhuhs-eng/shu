import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminOrganizationContracts } from "@/lib/contracts/actions";
import { contractStatusLabel, formatContractDate, monthLabel, successFeeModeLabel, yenOrUnset } from "@/lib/contracts/format";

type Props = { searchParams: Promise<{ filter?: string }> };

const FILTERS = [
  { key: "all", label: "すべて" },
  { key: "unset", label: "契約条件未設定" },
  { key: "trial", label: "試用中" },
  { key: "suspended", label: "一時停止" },
  { key: "cancelled", label: "解約" },
  { key: "no_amount", label: "成功報酬額が未設定" },
] as const;

/**
 * 運営者向けの契約一覧（/admin/contracts）。platform adminのみ。
 * 契約状態は情報として表示するだけで、利用の制限には使っていない。
 */
export default async function AdminContractsPage({ searchParams }: Props) {
  const { filter } = await searchParams;
  const active = FILTERS.find((f) => f.key === filter)?.key ?? "all";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/contracts");
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) redirect("/mypage");

  const all = await getAdminOrganizationContracts();
  const rows = all?.filter((o) => {
    switch (active) {
      case "unset": return o.contract === null;
      case "trial": return o.contract?.contract_status === "trial";
      case "suspended": return o.contract?.contract_status === "suspended";
      case "cancelled": return o.contract?.contract_status === "cancelled";
      case "no_amount": return o.contract !== null && o.contract.success_fee_amount === null;
      default: return true;
    }
  });

  return (
    <main className="mx-auto max-w-[900px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach Admin</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <Link href="/admin" className="text-[13px] font-semibold text-sub underline">← 運営ダッシュボード</Link>
      <h1 className="mt-4 font-serif text-2xl font-bold text-ink">契約一覧</h1>
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">
        会社ごとの契約条件です。契約状態は記録のためのもので、今の段階では機能の利用を制限しません。
      </p>

      <nav className="mt-4 flex flex-wrap gap-2" aria-label="絞り込み">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/admin/contracts" : `/admin/contracts?filter=${f.key}`}
            className={`rounded-full border px-3.5 py-1.5 text-[12px] font-semibold ${f.key === active ? "border-ink bg-ink text-white" : "border-line bg-surface text-charcoal"}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {all === null || rows === undefined ? (
        <p className="mt-6 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">契約情報を取得できませんでした。時間をおいて再度お試しください。</p>
      ) : rows.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-line bg-surface p-8 text-center text-[13px] text-sub">該当する会社はありません。</p>
      ) : (
        <div className="mt-5 space-y-3">
          {rows.map((o) => (
            <article key={o.organization_id} className="rounded-2xl border border-line bg-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-serif text-[16px] font-bold text-ink">{o.organization_name}</h2>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="rounded-full bg-surface2 px-3 py-1 text-[11px] font-semibold text-sub">{contractStatusLabel(o.contract?.contract_status ?? null)}</span>
                  <Link href={`/admin/companies/${o.organization_id}/contract`} className="text-[12px] font-semibold underline">{o.contract ? "編集 ›" : "設定する ›"}</Link>
                </div>
              </div>
              {o.contract === null ? (
                <p className="mt-3 text-[12px] text-charcoal">契約条件未設定 ／ 年度開始月 {monthLabel(o.fiscal_year_start_month)}</p>
              ) : (
                <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                  <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">成功報酬方式</dt><dd className="mt-0.5 font-bold">{successFeeModeLabel(o.contract.success_fee_mode)}</dd></div>
                  <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">契約成功報酬額</dt><dd className="mt-0.5 font-bold">{yenOrUnset(o.contract.success_fee_amount)}</dd></div>
                  <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">月額</dt><dd className="mt-0.5 font-bold">{yenOrUnset(o.contract.monthly_fee)}</dd></div>
                  <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">年度開始月</dt><dd className="mt-0.5 font-bold">{monthLabel(o.fiscal_year_start_month)}</dd></div>
                  <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">契約開始日</dt><dd className="mt-0.5 font-bold">{formatContractDate(o.contract.contract_started_at)}</dd></div>
                  <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">契約終了日</dt><dd className="mt-0.5 font-bold">{formatContractDate(o.contract.contract_ended_at)}</dd></div>
                  <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">最終更新日</dt><dd className="mt-0.5 font-bold">{formatContractDate(o.contract.updated_at)}</dd></div>
                </dl>
              )}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
