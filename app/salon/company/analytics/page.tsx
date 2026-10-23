import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { hasCompanyLevelRole } from "@/lib/hiring/permissions";
import { getCompanyHiringAnalytics } from "@/lib/hiring/analytics-actions";
import { HIRING_SOURCE_LABELS, HIRING_STATUS_LABELS } from "@/lib/hiring/format";
import { ATTENTION_THRESHOLD_DAYS, SOURCES, barWidth, findAttentionItems, percent } from "@/lib/hiring/analytics";

/**
 * 採用分析（/salon/company/analytics）。読み取り専用。
 *
 * ★入れる人: company_owner / company_admin / recruiting_admin は自社の全店舗、
 * area_manager は担当店舗のみ。店舗レベルの役割だけの担当者は /salon/company へ戻す
 * （middleware・このページ・DBのRPCの3層で守る）。
 * ★データは get_company_hiring_analytics を1回呼ぶだけ（店舗ごとのループなし）。
 * ★件数は履歴ベース：辞退・不採用になっても、過去に到達した段階（面談・選考・内定）は保持する。
 * 社内メモ・理由は取得しない。取得に失敗した場合は0件と表示しない。
 */
export default async function CompanyAnalyticsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/salon/company/analytics");
  if (!(await hasCompletedRole(supabase, user.id, "salon"))) redirect("/onboarding/salon");
  if (!(await hasCompanyLevelRole(supabase, user.id))) redirect("/salon/company");

  const analytics = await getCompanyHiringAnalytics();

  if (analytics === null) {
    return (
      <main className="mx-auto max-w-[760px] px-5 py-12">
        <Link href="/salon/company" className="text-[13px] font-semibold text-sub underline">← 会社ダッシュボードに戻る</Link>
        <h1 className="mt-5 font-serif text-2xl font-bold text-ink">採用活動の進み具合</h1>
        <p className="mt-6 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">分析結果を取得できませんでした。時間をおいて再度お試しください。</p>
      </main>
    );
  }

  const { total, by_source: bySource, by_store: byStore } = analytics;
  const attention = findAttentionItems(analytics.attention);
  const c = total.candidate_count;
  const sourceByKey = new Map(bySource.map((s) => [s.source, s]));

  const funnelSteps: Array<{ label: string; value: number }> = [
    { label: "候補者", value: total.candidate_count },
    { label: "面談化", value: total.interview_reached_count },
    { label: "面談実施", value: total.interview_completed_count },
    { label: "選考", value: total.selection_count },
    { label: "内定", value: total.offered_count },
    { label: "採用", value: total.hired_count },
  ];
  const rateCards: Array<{ label: string; value: string }> = [
    { label: "面談化率", value: percent(total.interview_reached_count, c) },
    { label: "面談実施率", value: percent(total.interview_completed_count, c) },
    { label: "内定率", value: percent(total.offered_count, c) },
    { label: "採用率", value: percent(total.hired_count, c) },
  ];

  return (
    <main className="mx-auto max-w-[760px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <Link href="/salon/company" className="text-[13px] font-semibold text-sub underline">← 会社ダッシュボードに戻る</Link>
      <p className="eyebrow mb-2 mt-5">採用分析</p>
      <h1 className="font-serif text-2xl font-bold text-ink">採用活動の進み具合</h1>
      <p className="mt-3 text-[13px] leading-relaxed text-charcoal">
        アクセスできる店舗（{byStore.length}店舗）の集計です。「面談化」「内定」などは、一度でもその段階に進んだ人数で、
        その後に辞退・不採用になった方も含みます。期間での絞り込みはありません。
      </p>

      <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <p className="eyebrow mb-3">採用までの流れ</p>
        <div className="space-y-2">
          {funnelSteps.map((step) => (
            <div key={step.label} className="flex items-center gap-3 text-[12px]">
              <span className="w-16 shrink-0 text-sub">{step.label}</span>
              <div className="h-5 flex-1 overflow-hidden rounded bg-surface2">
                <div className="h-full rounded bg-[#285B45]" style={{ width: `${barWidth(step.value, c)}%` }} />
              </div>
              <span className="w-10 shrink-0 text-right font-bold text-ink">{step.value}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-sub">
          現在の状況：{HIRING_STATUS_LABELS.declined ?? "辞退"} {total.declined_count}名 ／ {HIRING_STATUS_LABELS.rejected ?? "不採用"} {total.rejected_count}名
        </p>
      </section>

      <section className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {rateCards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[11px] text-sub">{card.label}</p>
            <p className="mt-1 font-serif text-[22px] font-bold text-ink">{card.value}</p>
          </div>
        ))}
      </section>

      <section className="mt-10">
        <p className="eyebrow mb-3">どの入口から採用につながったか</p>
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[520px] text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-sub">
                <th className="px-3 py-2.5 font-semibold">入口</th>
                <th className="px-2 py-2.5 text-center font-semibold">候補者</th>
                <th className="px-2 py-2.5 text-center font-semibold">面談化</th>
                <th className="px-2 py-2.5 text-center font-semibold">面談実施</th>
                <th className="px-2 py-2.5 text-center font-semibold">内定</th>
                <th className="px-2 py-2.5 text-center font-semibold">採用</th>
                <th className="px-2 py-2.5 text-center font-semibold">採用率</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((s) => {
                const row = sourceByKey.get(s);
                const cand = row?.candidate_count ?? 0;
                return (
                  <tr key={s} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5 font-semibold text-ink">{HIRING_SOURCE_LABELS[s]}</td>
                    <td className="px-2 py-2.5 text-center">{cand}</td>
                    <td className="px-2 py-2.5 text-center">{row?.interview_reached_count ?? 0}</td>
                    <td className="px-2 py-2.5 text-center">{row?.interview_completed_count ?? 0}</td>
                    <td className="px-2 py-2.5 text-center">{row?.offered_count ?? 0}</td>
                    <td className="px-2 py-2.5 text-center">{row?.hired_count ?? 0}</td>
                    <td className="px-2 py-2.5 text-center">{percent(row?.hired_count ?? 0, cand)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <p className="eyebrow mb-3">店舗ごとの比較</p>
        {byStore.length === 0 ? (
          <p className="text-[13px] text-sub">対象の店舗がありません。</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[700px] text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-sub">
                  <th className="px-3 py-2.5 font-semibold">店舗</th>
                  <th className="px-2 py-2.5 text-center font-semibold">候補者</th>
                  <th className="px-2 py-2.5 text-center font-semibold">面談化</th>
                  <th className="px-2 py-2.5 text-center font-semibold">面談実施</th>
                  <th className="px-2 py-2.5 text-center font-semibold">選考</th>
                  <th className="px-2 py-2.5 text-center font-semibold">内定</th>
                  <th className="px-2 py-2.5 text-center font-semibold">採用</th>
                  <th className="px-2 py-2.5 text-center font-semibold">辞退</th>
                  <th className="px-2 py-2.5 text-center font-semibold">不採用</th>
                  <th className="px-2 py-2.5 text-center font-semibold">採用率</th>
                </tr>
              </thead>
              <tbody>
                {byStore.map((st) => (
                  <tr key={st.store_id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5 font-semibold text-ink">{st.store_name}</td>
                    <td className="px-2 py-2.5 text-center">{st.candidate_count}</td>
                    <td className="px-2 py-2.5 text-center">{st.interview_reached_count}</td>
                    <td className="px-2 py-2.5 text-center">{st.interview_completed_count}</td>
                    <td className="px-2 py-2.5 text-center">{st.selection_count}</td>
                    <td className="px-2 py-2.5 text-center">{st.offered_count}</td>
                    <td className="px-2 py-2.5 text-center">{st.hired_count}</td>
                    <td className="px-2 py-2.5 text-center">{st.declined_count}</td>
                    <td className="px-2 py-2.5 text-center">{st.rejected_count}</td>
                    <td className="px-2 py-2.5 text-center">{percent(st.hired_count, st.candidate_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <p className="eyebrow mb-1">要確認の候補者</p>
        <p className="mb-3 text-[11.5px] leading-relaxed text-sub">
          更新が止まっている目安は、連絡調整中が{ATTENTION_THRESHOLD_DAYS.contacting}日、選考中が{ATTENTION_THRESHOLD_DAYS.inProgress}日、内定が{ATTENTION_THRESHOLD_DAYS.offered}日です（参考の目安です）。
        </p>
        {attention.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface p-6 text-center text-[13px] text-charcoal">確認が必要な候補者はいません。</p>
        ) : (
          <div className="space-y-2">
            {attention.slice(0, 50).map(({ row, reason }) => (
              <Link
                key={row.process_id}
                href={`/salon/stores/${row.store_id}/candidates/${row.process_id}`}
                className="block rounded-2xl border border-line bg-surface p-4"
              >
                <p className="text-[11px] text-sub">{row.store_name} ／ {HIRING_STATUS_LABELS[row.status] ?? "選考中"}</p>
                <p className="mt-0.5 font-serif text-[15px] font-bold text-ink">{row.stylist_name ?? "美容師"}</p>
                <p className="mt-1 text-[12px] text-charcoal">{reason}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
