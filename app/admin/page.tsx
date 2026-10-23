import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminSuccessFees } from "@/lib/billing/actions";
import { formatYen } from "@/lib/billing/format";
import { summarizeFees } from "@/lib/billing/summary";

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

  const fees = await getAdminSuccessFees();
  const summary = fees ? summarizeFees(fees) : null;

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

      <div className="mt-8 space-y-3">
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
