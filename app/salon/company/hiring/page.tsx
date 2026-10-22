import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { activeCount, countByStatus, getCompanyHiringScope, loadCompanyHiring } from "@/lib/hiring/company";
import { HIRING_STATUS_LABELS, formatJstDateTimeWithWeekday } from "@/lib/hiring/format";
import { formatJstDateTime } from "@/lib/store-activity/format";
import { HiringStatusBadge } from "@/components/hiring/status-badge";

type Props = {
  searchParams: Promise<{ store?: string; status?: string }>;
};

const LIST_LIMIT = 100;
const STORE_COLUMNS = [
  "contacting",
  "interview_scheduled",
  "interview_completed",
  "selection",
  "offered",
  "hired",
  "declined",
  "rejected",
] as const;

/**
 * 会社横断の採用ダッシュボード（/salon/company/hiring、Phase 10）。
 *
 * ★入れる人: company_owner / company_admin / recruiting_admin（会社の全店舗）、
 * area_manager（担当店舗のみ）。店舗レベルの役割だけの担当者は /salon/company へ戻す
 * （middlewareとこのページの両方で守る）。
 * ★データは既存の get_store_hiring_processes を店舗ごとに呼んで集計する（新しいDBなし）。
 * 各RPCが店舗アクセス権を検証するため、ここの絞り込みに誤りがあっても他店舗の
 * データは返らない。社内メモ・理由は画面に出さない（集計と一覧に必要な項目のみ使う）。
 */
export default async function CompanyHiringPage({ searchParams }: Props) {
  const { store: storeFilter, status: statusFilter } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/salon/company/hiring");
  }

  if (!(await hasCompletedRole(supabase, user.id, "salon"))) {
    redirect("/onboarding/salon");
  }

  const stores = await getCompanyHiringScope(supabase, user.id);
  if (stores === null) {
    redirect("/salon/company");
  }

  const { rows, failedStores } = await loadCompanyHiring(stores);
  const totalCounts = countByStatus(rows);
  const countsByStore = new Map<string, ReturnType<typeof countByStatus>>();
  for (const store of stores) {
    countsByStore.set(store.id, countByStatus(rows.filter((r) => r.store_id === store.id)));
  }

  const filtered = rows.filter(
    (r) => (!storeFilter || r.store_id === storeFilter) && (!statusFilter || r.status === statusFilter),
  );
  const shown = filtered.slice(0, LIST_LIMIT);
  const failedIds = new Set(failedStores.map((s) => s.id));

  const kpis: Array<{ label: string; value: number }> = [
    { label: "選考中（進行中の合計）", value: activeCount(totalCounts) },
    { label: "面談予定", value: totalCounts.interview_scheduled ?? 0 },
    { label: "内定", value: totalCounts.offered ?? 0 },
    { label: "採用", value: totalCounts.hired ?? 0 },
    { label: "辞退", value: totalCounts.declined ?? 0 },
    { label: "不採用", value: totalCounts.rejected ?? 0 },
  ];

  const orgNames = [...new Set(stores.map((s) => s.organizationName).filter((n): n is string => !!n))];

  function filterHref(next: { store?: string; status?: string }) {
    const params = new URLSearchParams();
    if (next.store) params.set("store", next.store);
    if (next.status) params.set("status", next.status);
    const qs = params.toString();
    return qs ? `/salon/company/hiring?${qs}` : "/salon/company/hiring";
  }

  return (
    <main className="mx-auto max-w-[760px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <Link href="/salon/company" className="text-[13px] font-semibold text-sub underline">
        ← 会社ダッシュボードに戻る
      </Link>

      <p className="eyebrow mb-2 mt-5">採用ダッシュボード</p>
      <h1 className="font-serif text-2xl font-bold text-ink">会社全体の採用状況</h1>
      <p className="mt-3 text-[13px] leading-relaxed text-charcoal">
        {orgNames.length > 0 ? `${orgNames.join("・")}の` : ""}
        アクセスできる店舗（{stores.length}店舗）の面談・選考の状況です。同じ美容師が複数の店舗で選考中でも、店舗ごとに別々に数えます。
      </p>

      {failedStores.length > 0 && (
        <p className="mt-4 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[11.5px] leading-relaxed text-[#8A2E2E]">
          一部の店舗（{failedStores.map((s) => s.name).join("、")}）の情報を取得できませんでした。
          下の数字にはこれらの店舗が含まれていません。時間をおいて再度お試しください。
        </p>
      )}

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[11px] text-sub">{kpi.label}</p>
            <p className="mt-1 font-serif text-[26px] font-bold text-ink">{kpi.value}</p>
          </div>
        ))}
      </section>

      <section className="mt-8">
        <p className="eyebrow mb-3">店舗別</p>
        {stores.length === 0 ? (
          <p className="text-[13px] text-sub">対象の店舗がありません。</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[640px] text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-sub">
                  <th className="px-3 py-2.5 font-semibold">店舗</th>
                  {STORE_COLUMNS.map((s) => (
                    <th key={s} className="px-2 py-2.5 text-center font-semibold">
                      {HIRING_STATUS_LABELS[s]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stores.map((store) => {
                  const counts = countsByStore.get(store.id) ?? {};
                  return (
                    <tr key={store.id} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-2.5">
                        <Link
                          href={filterHref({ store: store.id, status: statusFilter })}
                          className="font-semibold text-ink underline"
                        >
                          {store.name}
                        </Link>
                        {failedIds.has(store.id) && <span className="ml-1 text-[10px] text-[#8A2E2E]">取得不可</span>}
                      </td>
                      {STORE_COLUMNS.map((s) => (
                        <td key={s} className="px-2 py-2.5 text-center text-charcoal">
                          {failedIds.has(store.id) ? "-" : (counts[s] ?? 0)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8">
        <p className="eyebrow mb-3">候補者一覧</p>

        <div className="mb-4 flex flex-wrap gap-2">
          <Link
            href={filterHref({ store: storeFilter })}
            className={`rounded-full border px-3 py-1.5 text-[11.5px] font-semibold ${
              !statusFilter ? "border-ink bg-ink text-surface" : "border-line bg-surface text-charcoal"
            }`}
          >
            すべての状況
          </Link>
          {STORE_COLUMNS.map((s) => (
            <Link
              key={s}
              href={filterHref({ store: storeFilter, status: s })}
              className={`rounded-full border px-3 py-1.5 text-[11.5px] font-semibold ${
                statusFilter === s ? "border-ink bg-ink text-surface" : "border-line bg-surface text-charcoal"
              }`}
            >
              {HIRING_STATUS_LABELS[s]}
            </Link>
          ))}
        </div>
        {storeFilter && (
          <p className="mb-3 text-[12px] text-sub">
            店舗で絞り込み中：{stores.find((s) => s.id === storeFilter)?.name ?? "（対象外の店舗）"}　
            <Link href={filterHref({ status: statusFilter })} className="underline">
              解除
            </Link>
          </p>
        )}

        {shown.length === 0 ? (
          <p className="text-center text-[13px] text-sub">該当する候補者はいません。</p>
        ) : (
          <div className="space-y-3">
            {shown.map((r) => (
              <article key={r.process_id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-serif text-[15px] font-bold text-ink">{r.public_name ?? "美容師"}</h3>
                    <p className="mt-1 text-[12px] text-sub">{r.storeName}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <HiringStatusBadge status={r.status} />
                    {r.match.available && r.match.overall_score != null && (
                      <span className="text-[11px] font-semibold" style={{ color: "#2E8B7F" }}>
                        相性 {r.match.overall_score}%
                      </span>
                    )}
                  </div>
                </div>
                <dl className="mt-3 space-y-1 text-[12px] text-charcoal">
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-sub">面談日時</dt>
                    <dd>{r.interview_at ? formatJstDateTimeWithWeekday(r.interview_at) : "未定"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-sub">最終更新</dt>
                    <dd>{formatJstDateTime(r.updated_at)}</dd>
                  </div>
                </dl>
                <Link
                  href={`/salon/stores/${r.store_id}/candidates/${r.process_id}`}
                  className="mt-3 inline-block text-[12px] font-semibold text-ink underline"
                >
                  詳細を見る ›
                </Link>
              </article>
            ))}
          </div>
        )}
        {filtered.length > LIST_LIMIT && (
          <p className="mt-3 text-center text-[11px] text-sub">
            新しい順に{LIST_LIMIT}件を表示しています（該当{filtered.length}件）。店舗や状況で絞り込めます。
          </p>
        )}
      </section>
    </main>
  );
}
