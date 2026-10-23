import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { getCompanyHiringScope, loadCompanyHiring } from "@/lib/hiring/company";
import { HIRING_SOURCE_LABELS, HIRING_STATUS_LABELS } from "@/lib/hiring/format";
import {
  ATTENTION_THRESHOLD_DAYS,
  SOURCES,
  findAttentionItems,
  funnel,
  groupBy,
  percent,
  rates,
} from "@/lib/hiring/analytics";

/**
 * 採用分析（/salon/company/analytics、Phase 16〜19）。読み取り専用。
 *
 * ★入れる人は /salon/company/hiring と同じ（company_owner / company_admin /
 * recruiting_admin は全店舗、area_manager は担当店舗のみ）。middlewareとこのページの両方で守る。
 * ★データは既存の get_store_hiring_processes（店舗ごと）。新しいDBは使わない。
 * ★集計は「現在の状態」のみ（期間分析なし）。辞退・不採用になった人は途中の段階には含まれない。
 * ★社内メモ・理由は使わない。
 */
export default async function CompanyAnalyticsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/salon/company/analytics");
  if (!(await hasCompletedRole(supabase, user.id, "salon"))) redirect("/onboarding/salon");

  const stores = await getCompanyHiringScope(supabase, user.id);
  if (stores === null) redirect("/salon/company");

  const { rows, failedStores } = await loadCompanyHiring(stores);
  const total = funnel(rows);
  const totalRates = rates(total);
  const bySource = groupBy(rows, (r) => r.source);
  const byStore = groupBy(rows, (r) => r.store_id);
  const attention = findAttentionItems(rows);

  const funnelCards: Array<{ label: string; value: number }> = [
    { label: "候補者数", value: total.candidates },
    { label: HIRING_STATUS_LABELS.interview_scheduled ?? "面談予定", value: total.interviewScheduled },
    { label: HIRING_STATUS_LABELS.interview_completed ?? "面談済み", value: total.interviewCompleted },
    { label: HIRING_STATUS_LABELS.selection ?? "選考中", value: total.selection },
    { label: HIRING_STATUS_LABELS.offered ?? "内定", value: total.offered },
    { label: HIRING_STATUS_LABELS.hired ?? "採用", value: total.hired },
    { label: HIRING_STATUS_LABELS.declined ?? "辞退", value: total.declined },
    { label: HIRING_STATUS_LABELS.rejected ?? "不採用", value: total.rejected },
  ];

  return (
    <main className="mx-auto max-w-[760px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <Link href="/salon/company" className="text-[13px] font-semibold text-sub underline">← 会社ダッシュボードに戻る</Link>
      <p className="eyebrow mb-2 mt-5">採用分析</p>
      <h1 className="font-serif text-2xl font-bold text-ink">採用活動の進み具合</h1>
      <p className="mt-3 text-[13px] leading-relaxed text-charcoal">
        アクセスできる店舗（{stores.length}店舗）の、現在の状況の集計です。割合は現在の状態から計算しており、
        途中で辞退・不採用になった方は、進んだ段階の数には含まれません。
      </p>

      {failedStores.length > 0 && (
        <p className="mt-4 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[11.5px] leading-relaxed text-[#8A2E2E]">
          一部の店舗（{failedStores.map((s) => s.name).join("、")}）の情報を取得できませんでした。下の数字にはこれらの店舗が含まれていません。
        </p>
      )}

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {funnelCards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[11px] text-sub">{c.label}</p>
            <p className="mt-1 font-serif text-[24px] font-bold text-ink">{c.value}</p>
          </div>
        ))}
      </section>
      <section className="mt-3 grid grid-cols-3 gap-3">
        {[
          { label: "面談化率", value: totalRates.interview },
          { label: "内定率", value: totalRates.offer },
          { label: "採用率", value: totalRates.hire },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[11px] text-sub">{c.label}</p>
            <p className="mt-1 font-serif text-[22px] font-bold text-ink">{c.value}</p>
          </div>
        ))}
      </section>

      <section className="mt-10">
        <p className="eyebrow mb-3">どの入口から採用につながったか</p>
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[480px] text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-sub">
                <th className="px-3 py-2.5 font-semibold">入口</th>
                <th className="px-2 py-2.5 text-center font-semibold">候補者</th>
                <th className="px-2 py-2.5 text-center font-semibold">面談段階以降</th>
                <th className="px-2 py-2.5 text-center font-semibold">内定</th>
                <th className="px-2 py-2.5 text-center font-semibold">採用</th>
                <th className="px-2 py-2.5 text-center font-semibold">採用率</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((s) => {
                const f = funnel(bySource.get(s) ?? []);
                return (
                  <tr key={s} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5 font-semibold text-ink">{HIRING_SOURCE_LABELS[s]}</td>
                    <td className="px-2 py-2.5 text-center">{f.candidates}</td>
                    <td className="px-2 py-2.5 text-center">{f.progressed}</td>
                    <td className="px-2 py-2.5 text-center">{f.offered}</td>
                    <td className="px-2 py-2.5 text-center">{f.hired}</td>
                    <td className="px-2 py-2.5 text-center">{percent(f.hired, f.candidates)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <p className="eyebrow mb-3">店舗ごとの比較</p>
        {stores.length === 0 ? (
          <p className="text-[13px] text-sub">対象の店舗がありません。</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[640px] text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-sub">
                  <th className="px-3 py-2.5 font-semibold">店舗</th>
                  <th className="px-2 py-2.5 text-center font-semibold">候補者</th>
                  <th className="px-2 py-2.5 text-center font-semibold">面談段階以降</th>
                  <th className="px-2 py-2.5 text-center font-semibold">内定</th>
                  <th className="px-2 py-2.5 text-center font-semibold">採用</th>
                  <th className="px-2 py-2.5 text-center font-semibold">辞退</th>
                  <th className="px-2 py-2.5 text-center font-semibold">不採用</th>
                  <th className="px-2 py-2.5 text-center font-semibold">採用率</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((store) => {
                  const f = funnel(byStore.get(store.id) ?? []);
                  const failed = failedStores.some((s) => s.id === store.id);
                  return (
                    <tr key={store.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2.5 font-semibold text-ink">{store.name}</td>
                      {failed ? (
                        <td colSpan={7} className="px-2 py-2.5 text-center text-[#8A2E2E]">取得できませんでした</td>
                      ) : (
                        <>
                          <td className="px-2 py-2.5 text-center">{f.candidates}</td>
                          <td className="px-2 py-2.5 text-center">{f.progressed}</td>
                          <td className="px-2 py-2.5 text-center">{f.offered}</td>
                          <td className="px-2 py-2.5 text-center">{f.hired}</td>
                          <td className="px-2 py-2.5 text-center">{f.declined}</td>
                          <td className="px-2 py-2.5 text-center">{f.rejected}</td>
                          <td className="px-2 py-2.5 text-center">{percent(f.hired, f.candidates)}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
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
                <p className="text-[11px] text-sub">{row.storeName} ／ {HIRING_STATUS_LABELS[row.status] ?? "選考中"}</p>
                <p className="mt-0.5 font-serif text-[15px] font-bold text-ink">{row.public_name ?? "美容師"}</p>
                <p className="mt-1 text-[12px] text-charcoal">{reason}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
