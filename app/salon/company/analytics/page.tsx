import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { hasCompanyLevelRole } from "@/lib/hiring/permissions";
import { getCompanyHiringAnalytics, getHiringActivity, getHiringCohort } from "@/lib/hiring/analytics-actions";
import { HIRING_SOURCE_LABELS, HIRING_STATUS_LABELS } from "@/lib/hiring/format";
import {
  ATTENTION_THRESHOLD_DAYS, SOURCES, barWidth, diffLabel, findAttentionItems, percent, ratePointDiff,
  cohortCsvRows, COHORT_CSV_HEADER, type ActivityResult, type CohortResult,
} from "@/lib/hiring/analytics";
import { PERIOD_KEYS, PERIOD_LABELS, isPeriodKey, resolvePeriod, type PeriodKey } from "@/lib/hiring/period";
import { ExportCsvButton } from "@/components/analytics/export-csv-button";

type Props = { searchParams: Promise<{ period?: string; compare?: string }> };

const ERROR_BOX = "rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]";
const TH = "px-2 py-2.5 text-center font-semibold";
const TD = "px-2 py-2.5 text-center";

/**
 * 採用分析（/salon/company/analytics）。読み取り専用。
 *
 * ★入れる人: company_owner / company_admin / recruiting_admin は自社の全店舗、
 * area_manager は担当店舗のみ。それ以外は /salon/company へ戻す（middleware・このページ・RPCの3層）。
 * ★期間は日本時間の月初基準（lib/hiring/period.ts）。年度は4月始まりのUI定数。
 * ★「この期間の採用活動」（活動ベース）と「この期間に候補者になった人の進捗」（コホート）は意味が違うので、
 * 見出しも説明も分けて、活動の数字同士を通過率にはしない。
 * ★社内メモ・理由は取得しない。取得に失敗した場合は0件と表示しない。
 */
export default async function CompanyAnalyticsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const periodKey: PeriodKey = isPeriodKey(sp.period) ? sp.period : "this_month";
  const compareRequested = sp.compare === "1";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/salon/company/analytics`);
  if (!(await hasCompletedRole(supabase, user.id, "salon"))) redirect("/onboarding/salon");
  if (!(await hasCompanyLevelRole(supabase, user.id))) redirect("/salon/company");

  const now = new Date();
  const period = resolvePeriod(periodKey, now);
  if (!period) redirect("/salon/company/analytics");
  const prevPeriod = compareRequested ? resolvePeriod(periodKey, now, 1) : null;

  const [activity, cohort, current, prevActivity, prevCohort] = await Promise.all([
    getHiringActivity(period.from, period.to),
    getHiringCohort(period.from, period.to),
    getCompanyHiringAnalytics(),
    prevPeriod ? getHiringActivity(prevPeriod.from, prevPeriod.to) : Promise.resolve(null),
    prevPeriod ? getHiringCohort(prevPeriod.from, prevPeriod.to) : Promise.resolve(null),
  ]);

  const tabHref = (key: PeriodKey) => `/salon/company/analytics?period=${key}${compareRequested && key !== "all" ? "&compare=1" : ""}`;
  const compareHref = `/salon/company/analytics?period=${periodKey}${compareRequested ? "" : "&compare=1"}`;
  const canCompare = periodKey !== "all";

  return (
    <main className="mx-auto max-w-[760px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <Link href="/salon/company" className="text-[13px] font-semibold text-sub underline">← 会社ダッシュボードに戻る</Link>
      <p className="eyebrow mb-2 mt-5">採用分析</p>
      <h1 className="font-serif text-2xl font-bold text-ink">採用活動の進み具合</h1>
      <p className="mt-3 text-[13px] leading-relaxed text-charcoal">
        アクセスできる店舗の集計です。期間は日本時間で区切っています。
      </p>

      <nav className="mt-5 flex flex-wrap gap-2" aria-label="期間">
        {PERIOD_KEYS.map((key) => (
          <Link
            key={key}
            href={tabHref(key)}
            className={`rounded-full border px-4 py-1.5 text-[12px] font-semibold ${key === periodKey ? "border-ink bg-ink text-white" : "border-line bg-surface text-charcoal"}`}
          >
            {PERIOD_LABELS[key]}
          </Link>
        ))}
      </nav>
      <p className="mt-2 text-[12px] text-sub">対象期間：{period.rangeLabel}</p>

      {/* ===== A. 活動ベース ===== */}
      <section className="mt-8 rounded-2xl border border-line bg-surface p-5">
        <p className="eyebrow mb-1">A. 活動</p>
        <h2 className="font-serif text-[17px] font-bold text-ink">この期間の採用活動</h2>
        <p className="mt-1 text-[11.5px] leading-relaxed text-sub">
          この期間に初めて各段階へ進んだ人数です。段階ごとの人数は別々の人を数えているため、割り算して通過率にはできません。
        </p>
        {activity === null ? (
          <p className={`mt-4 ${ERROR_BOX}`}>取得できませんでした。時間をおいて再度お試しください。</p>
        ) : (
          <ActivitySection activity={activity} />
        )}
      </section>

      {/* ===== B. コホート ===== */}
      <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <p className="eyebrow mb-1">B. 進捗</p>
        <h2 className="font-serif text-[17px] font-bold text-ink">この期間に候補者になった人の進捗</h2>
        <p className="mt-1 text-[11.5px] leading-relaxed text-sub">
          この期間に候補者になった人が、現在までに進んだ段階の人数です。選考継続中の候補者を含みます。割合は「候補者数」に対するものです。
        </p>
        {cohort === null ? (
          <p className={`mt-4 ${ERROR_BOX}`}>取得できませんでした。時間をおいて再度お試しください。</p>
        ) : (
          <CohortSection cohort={cohort} />
        )}
      </section>

      {/* ===== 期間の比較 ===== */}
      {canCompare && (
        <section className="mt-6">
          <div className="flex items-center justify-between">
            <p className="eyebrow">前の期間との比較</p>
            <Link href={compareHref} className="text-[12px] font-semibold underline">{compareRequested ? "比較を閉じる" : "比較を表示"}</Link>
          </div>
          {compareRequested && prevPeriod && (
            <div className="mt-3 rounded-2xl border border-line bg-surface p-5">
              <p className="text-[12px] text-charcoal">{period.rangeLabel} と {prevPeriod.rangeLabel} の比較</p>
              {activity === null || prevActivity === null || cohort === null || prevCohort === null ? (
                <p className={`mt-3 ${ERROR_BOX}`}>比較に必要なデータを取得できませんでした。</p>
              ) : (
                <Comparison activity={activity} prevActivity={prevActivity} cohort={cohort} prevCohort={prevCohort} />
              )}
            </div>
          )}
        </section>
      )}

      {/* ===== 現在の状況（期間に関係なく） ===== */}
      <section className="mt-10">
        <p className="eyebrow mb-1">これまでの累計（期間に関係なく現在）</p>
        {current === null ? (
          <p className={`mt-2 ${ERROR_BOX}`}>取得できませんでした。時間をおいて再度お試しください。</p>
        ) : (
          <CurrentSection current={current} />
        )}
      </section>
    </main>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl bg-surface2 p-3">
      <p className="text-[11px] text-sub">{label}</p>
      <p className="mt-0.5 font-serif text-[20px] font-bold text-ink">{value}</p>
      {sub && <p className="text-[10.5px] text-sub">{sub}</p>}
    </div>
  );
}

function UnknownNote({ text }: { text: string }) {
  return <p className="mt-4 text-[10.5px] text-sub">{text}</p>;
}

function ActivitySection({ activity }: { activity: ActivityResult }) {
  const a = activity.activity;
  const items: Array<[string, number]> = [
    ["候補者追加", a.added_count], ["面談化", a.interview_reached_count], ["面談実施", a.interview_completed_count],
    ["選考到達", a.selection_count], ["内定到達", a.offered_count], ["採用", a.hired_count],
    ["辞退", a.declined_count], ["不採用", a.rejected_count],
  ];
  const srcMap = new Map(activity.by_source.map((s) => [s.source, s]));
  const unknown = activity.unknown_dates.no_candidate_added_count + activity.unknown_dates.no_events_count;
  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map(([label, value]) => <Kpi key={label} label={label} value={value} />)}
      </div>

      <p className="eyebrow mb-2 mt-6">どの入口から動いたか</p>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[480px] text-[12px]">
          <thead><tr className="border-b border-line text-left text-sub">
            <th className="px-3 py-2.5 font-semibold">入口</th><th className={TH}>候補者追加</th><th className={TH}>面談化</th>
            <th className={TH}>面談実施</th><th className={TH}>内定</th><th className={TH}>採用</th>
          </tr></thead>
          <tbody>
            {SOURCES.map((s) => {
              const r = srcMap.get(s);
              return (
                <tr key={s} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5 font-semibold text-ink">{HIRING_SOURCE_LABELS[s]}</td>
                  <td className={TD}>{r?.added_count ?? 0}</td><td className={TD}>{r?.interview_reached_count ?? 0}</td>
                  <td className={TD}>{r?.interview_completed_count ?? 0}</td><td className={TD}>{r?.offered_count ?? 0}</td>
                  <td className={TD}>{r?.hired_count ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-[12px] font-semibold text-sub">店舗ごとの活動を見る（{activity.by_store.length}店舗）</summary>
        <div className="mt-2 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-[12px]">
            <thead><tr className="border-b border-line text-left text-sub">
              <th className="px-3 py-2.5 font-semibold">店舗</th><th className={TH}>追加</th><th className={TH}>面談化</th><th className={TH}>面談実施</th>
              <th className={TH}>選考</th><th className={TH}>内定</th><th className={TH}>採用</th><th className={TH}>辞退</th><th className={TH}>不採用</th>
            </tr></thead>
            <tbody>
              {activity.by_store.map((st) => (
                <tr key={st.store_id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5 font-semibold text-ink">{st.store_name}</td>
                  <td className={TD}>{st.added_count}</td><td className={TD}>{st.interview_reached_count}</td><td className={TD}>{st.interview_completed_count}</td>
                  <td className={TD}>{st.selection_count}</td><td className={TD}>{st.offered_count}</td><td className={TD}>{st.hired_count}</td>
                  <td className={TD}>{st.declined_count}</td><td className={TD}>{st.rejected_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {unknown > 0 && <UnknownNote text={`日付を判定できない過去データ：${unknown}件（この集計には含まれません）`} />}
    </>
  );
}

function CohortSection({ cohort }: { cohort: CohortResult }) {
  const t = cohort.cohort;
  const c = t.candidate_count;
  const steps: Array<[string, number]> = [
    ["候補者数", c], ["面談化", t.interview_reached_count], ["面談実施", t.interview_completed_count],
    ["選考到達", t.selection_count], ["内定到達", t.offered_count], ["採用", t.hired_count],
  ];
  const rates: Array<[string, string]> = [
    ["面談化率", percent(t.interview_reached_count, c)], ["面談実施率", percent(t.interview_completed_count, c)],
    ["内定率", percent(t.offered_count, c)], ["採用率", percent(t.hired_count, c)],
  ];
  const srcMap = new Map(cohort.by_source.map((s) => [s.source, s]));
  const unknown = cohort.unknown_dates.cohort_date_unknown_count;
  return (
    <>
      <div className="mt-4 space-y-2">
        {steps.map(([label, value]) => (
          <div key={label} className="flex items-center gap-3 text-[12px]">
            <span className="w-16 shrink-0 text-sub">{label}</span>
            <div className="h-5 flex-1 overflow-hidden rounded bg-surface2">
              <div className="h-full rounded bg-[#285B45]" style={{ width: `${barWidth(value, c)}%` }} />
            </div>
            <span className="w-10 shrink-0 text-right font-bold text-ink">{value}</span>
          </div>
        ))}
        <p className="text-[11px] text-sub">辞退 {t.declined_count}名 ／ 不採用 {t.rejected_count}名（現在の状況）</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {rates.map(([label, value]) => <Kpi key={label} label={label} value={value} />)}
      </div>

      <p className="eyebrow mb-2 mt-6">入口別</p>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[520px] text-[12px]">
          <thead><tr className="border-b border-line text-left text-sub">
            <th className="px-3 py-2.5 font-semibold">入口</th><th className={TH}>候補者</th><th className={TH}>面談化</th>
            <th className={TH}>面談実施</th><th className={TH}>内定</th><th className={TH}>採用</th><th className={TH}>採用率</th>
          </tr></thead>
          <tbody>
            {SOURCES.map((s) => {
              const r = srcMap.get(s);
              const cand = r?.candidate_count ?? 0;
              return (
                <tr key={s} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5 font-semibold text-ink">{HIRING_SOURCE_LABELS[s]}</td>
                  <td className={TD}>{cand}</td><td className={TD}>{r?.interview_reached_count ?? 0}</td>
                  <td className={TD}>{r?.interview_completed_count ?? 0}</td><td className={TD}>{r?.offered_count ?? 0}</td>
                  <td className={TD}>{r?.hired_count ?? 0}</td><td className={TD}>{percent(r?.hired_count ?? 0, cand)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="eyebrow mb-2 mt-6">店舗別</p>
      {cohort.by_store.length === 0 ? (
        <p className="text-[13px] text-sub">対象の店舗がありません。</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[700px] text-[12px]">
            <thead><tr className="border-b border-line text-left text-sub">
              <th className="px-3 py-2.5 font-semibold">店舗</th><th className={TH}>候補者</th><th className={TH}>面談化</th><th className={TH}>面談実施</th>
              <th className={TH}>選考</th><th className={TH}>内定</th><th className={TH}>採用</th><th className={TH}>辞退</th><th className={TH}>不採用</th><th className={TH}>採用率</th>
            </tr></thead>
            <tbody>
              {cohort.by_store.map((st) => (
                <tr key={st.store_id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5 font-semibold text-ink">{st.store_name}</td>
                  <td className={TD}>{st.candidate_count}</td><td className={TD}>{st.interview_reached_count}</td><td className={TD}>{st.interview_completed_count}</td>
                  <td className={TD}>{st.selection_count}</td><td className={TD}>{st.offered_count}</td><td className={TD}>{st.hired_count}</td>
                  <td className={TD}>{st.declined_count}</td><td className={TD}>{st.rejected_count}</td>
                  <td className={TD}>{percent(st.hired_count, st.candidate_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4"><ExportCsvButton filename="hiring-cohort.csv" header={COHORT_CSV_HEADER} rows={cohortCsvRows(cohort)} /></div>
      {unknown > 0 && <UnknownNote text={`日付を判定できない過去データ：${unknown}件（この集計には含まれません）`} />}
    </>
  );
}

function Comparison({ activity, prevActivity, cohort, prevCohort }: {
  activity: ActivityResult; prevActivity: ActivityResult; cohort: CohortResult; prevCohort: CohortResult;
}) {
  const a = activity.activity, p = prevActivity.activity;
  const rows: Array<[string, number, number]> = [
    ["候補者追加", a.added_count, p.added_count], ["面談化", a.interview_reached_count, p.interview_reached_count],
    ["内定到達", a.offered_count, p.offered_count], ["採用", a.hired_count, p.hired_count],
  ];
  const c = cohort.cohort, pc = prevCohort.cohort;
  const rateRows: Array<[string, number, number, number, number]> = [
    ["面談化率", c.interview_reached_count, c.candidate_count, pc.interview_reached_count, pc.candidate_count],
    ["採用率", c.hired_count, c.candidate_count, pc.hired_count, pc.candidate_count],
  ];
  return (
    <>
      <p className="eyebrow mb-2 mt-4">この期間の採用活動（人数）</p>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[360px] text-[12px]">
          <thead><tr className="border-b border-line text-left text-sub">
            <th className="px-3 py-2.5 font-semibold">項目</th><th className={TH}>今回</th><th className={TH}>前回</th><th className={TH}>差</th>
          </tr></thead>
          <tbody>
            {rows.map(([label, cur, prev]) => (
              <tr key={label} className="border-b border-line last:border-0">
                <td className="px-3 py-2.5 font-semibold text-ink">{label}</td><td className={TD}>{cur}</td><td className={TD}>{prev}</td>
                <td className={`${TD} font-bold`}>{diffLabel(cur, prev)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="eyebrow mb-2 mt-5">候補者になった人の割合</p>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[360px] text-[12px]">
          <thead><tr className="border-b border-line text-left text-sub">
            <th className="px-3 py-2.5 font-semibold">項目</th><th className={TH}>今回</th><th className={TH}>前回</th><th className={TH}>差</th>
          </tr></thead>
          <tbody>
            {rateRows.map(([label, n, d, pn, pd]) => (
              <tr key={label} className="border-b border-line last:border-0">
                <td className="px-3 py-2.5 font-semibold text-ink">{label}</td><td className={TD}>{percent(n, d)}</td><td className={TD}>{percent(pn, pd)}</td>
                <td className={`${TD} font-bold`}>{ratePointDiff(n, d, pn, pd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-sub">
        割合は、前回の期間の候補者のほうが経過した時間が長いぶん、先の段階へ進んでいる傾向があります。直近の期間は、今後の進み具合で変わります。
      </p>
    </>
  );
}

function CurrentSection({ current }: { current: NonNullable<Awaited<ReturnType<typeof getCompanyHiringAnalytics>>> }) {
  const { total } = current;
  const attention = findAttentionItems(current.attention);
  const c = total.candidate_count;
  const steps: Array<[string, number]> = [
    ["候補者", total.candidate_count], ["面談化", total.interview_reached_count], ["面談実施", total.interview_completed_count],
    ["選考", total.selection_count], ["内定", total.offered_count], ["採用", total.hired_count],
  ];
  return (
    <>
      <div className="mt-3 rounded-2xl border border-line bg-surface p-5">
        <div className="space-y-2">
          {steps.map(([label, value]) => (
            <div key={label} className="flex items-center gap-3 text-[12px]">
              <span className="w-16 shrink-0 text-sub">{label}</span>
              <div className="h-5 flex-1 overflow-hidden rounded bg-surface2">
                <div className="h-full rounded bg-[#285B45]" style={{ width: `${barWidth(value, c)}%` }} />
              </div>
              <span className="w-10 shrink-0 text-right font-bold text-ink">{value}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-sub">
          現在の状況：{HIRING_STATUS_LABELS.declined ?? "辞退"} {total.declined_count}名 ／ {HIRING_STATUS_LABELS.rejected ?? "不採用"} {total.rejected_count}名
          。一度でも到達した段階の人数で、その後に辞退・不採用になった方も含みます。
        </p>
      </div>

      <div className="mt-8">
        <p className="eyebrow mb-1">要確認の候補者</p>
        <p className="mb-3 text-[11.5px] leading-relaxed text-sub">
          更新が止まっている目安は、連絡調整中が{ATTENTION_THRESHOLD_DAYS.contacting}日、選考中が{ATTENTION_THRESHOLD_DAYS.inProgress}日、内定が{ATTENTION_THRESHOLD_DAYS.offered}日です（参考の目安です）。
        </p>
        {attention.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface p-6 text-center text-[13px] text-charcoal">確認が必要な候補者はいません。</p>
        ) : (
          <div className="space-y-2">
            {attention.slice(0, 50).map(({ row, reason }) => (
              <Link key={row.process_id} href={`/salon/stores/${row.store_id}/candidates/${row.process_id}`} className="block rounded-2xl border border-line bg-surface p-4">
                <p className="text-[11px] text-sub">{row.store_name} ／ {HIRING_STATUS_LABELS[row.status] ?? "選考中"}</p>
                <p className="mt-0.5 font-serif text-[15px] font-bold text-ink">{row.stylist_name ?? "美容師"}</p>
                <p className="mt-1 text-[12px] text-charcoal">{reason}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
