import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminOrganizationOverview } from "@/lib/billing/actions";
import { formatYen } from "@/lib/billing/format";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });
}

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

  const orgs = await getAdminOrganizationOverview();

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
        <div className="mt-6 space-y-4">
          {orgs.map((o) => (
            <article key={o.organization_id} className="rounded-2xl border border-line bg-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-serif text-lg font-bold text-ink">{o.organization_name}</h2>
                <Link href={`/admin/companies/${o.organization_id}`} className="shrink-0 text-[12px] font-semibold underline">詳細 ›</Link>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px] sm:grid-cols-6">
                {[
                  ["店舗数", o.store_count], ["利用中店舗", o.active_store_count], ["候補者", o.candidate_count],
                  ["面談到達", o.interview_count], ["内定", o.offered_count], ["採用", o.hired_count],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-surface2 p-2"><dt className="text-sub">{label}</dt><dd className="mt-0.5 text-[15px] font-bold text-ink">{value}</dd></div>
                ))}
              </dl>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px] sm:grid-cols-7">
                {[
                  ["成功報酬", o.success_fee_count], ["請求確認中", o.pending_confirmation_count], ["請求額確定", o.confirmed_count],
                  ["請求済み", o.invoiced_count], ["入金済み", o.paid_count], ["免除", o.waived_count], ["取消", o.cancelled_count],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-surface2 p-2"><dt className="text-sub">{label}</dt><dd className="mt-0.5 text-[15px] font-bold text-ink">{value}</dd></div>
                ))}
              </dl>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">成功報酬総額</dt><dd className="mt-0.5 text-[13px] font-bold">{formatYen(o.confirmed_total_amount)}</dd></div>
                <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">請求済み総額</dt><dd className="mt-0.5 text-[13px] font-bold">{formatYen(o.invoiced_total_amount)}</dd></div>
                <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">入金済み総額</dt><dd className="mt-0.5 text-[13px] font-bold">{formatYen(o.paid_total_amount)}</dd></div>
              </dl>
              <p className="mt-3 text-[11px] text-sub">直近採用日 {fmtDate(o.latest_hired_at)} ／ 直近活動日 {fmtDate(o.latest_activity_at)}</p>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
