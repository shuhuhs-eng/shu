import Link from "next/link";
import { requireAdminOperator } from "@/lib/admin/operator-guard";
import {
  HIRING_STATUSES, listHiringProcesses, parseHiringStatus, parseHiringView, parseOpsPage, parsePeriod, type HiringView,
} from "@/lib/admin/operations";
import { HIRING_SOURCE_LABELS, HIRING_STATUS_LABELS, INTERVIEW_TYPE_LABELS } from "@/lib/hiring/format";
import {
  contactSalonHref, contactStylistHref, fmtJst, linkCls, OpsEmpty, OpsError, OpsPager, PageHead, PeriodFields, stylistLabel,
} from "@/components/admin/operations-ui";

type SP = Promise<Record<string, string | string[] | undefined>>;

const VIEW_LABEL: Record<HiringView, string> = {
  interview_elapsed_not_updated: "面接予定日時を過ぎて結果が未更新",
  interview_scheduled: "面接予定",
  all: "すべての進捗",
};

/**
 * 運営: 面接・採用の進捗（読み取り専用）。0085 の admin_list_hiring_processes を使う。
 * ★「面接予定日時を過ぎて結果が未更新」は、面接が実施されたことを意味しない（延期・欠席・更新漏れを含み得る）。
 * ★自動の通知・督促は行わない。連絡は既存の連絡機能へのリンクだけを用意する（ここでは送信しない）。
 */
export default async function AdminInterviewsPage({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireAdminOperator("/admin/interviews");
  const sp = await searchParams;
  const view = parseHiringView(sp), status = parseHiringStatus(sp), period = parsePeriod(sp), page = parseOpsPage(sp);
  const res = period.invalid ? null : await listHiringProcesses(supabase, { view, status, period, page });
  const params: Record<string, string> = { view };
  if (view === "all" && status) params.status = status;
  if (period.fromDate) params.from = period.fromDate;
  if (period.toDate) params.to = period.toDate;
  const sel = "min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 text-[13px]";
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <PageHead
        title="面接・採用の進捗"
        lead={<>面接の予定と、<b>面接予定日時を過ぎても結果が更新されていない</b>進捗を確認します。これは<b>面接が実施されたという意味ではありません</b>（延期・欠席・更新漏れを含みます）。自動の通知・督促は行いません。</>}
      />
      <form method="get" className="mt-5 grid gap-3 rounded-2xl border border-line bg-surface p-4">
        <select name="view" defaultValue={view} className={sel} aria-label="表示する内容">
          {(Object.keys(VIEW_LABEL) as HiringView[]).map((v) => <option key={v} value={v}>{VIEW_LABEL[v]}</option>)}
        </select>
        <select name="status" defaultValue={status} className={sel} aria-label="状態（「すべての進捗」のときだけ有効）">
          <option value="">状態（すべて）※「すべての進捗」のときだけ有効</option>
          {HIRING_STATUSES.map((s) => <option key={s} value={s}>{HIRING_STATUS_LABELS[s] ?? s}</option>)}
        </select>
        <PeriodFields period={period} label={view === "all" ? "期間（最終更新日）" : "期間（面接予定日時）"} />
        <button className="min-h-[44px] rounded-full bg-ink px-5 text-[13px] font-semibold text-white">絞り込む</button>
      </form>
      {view !== "all" && period.fromDate === "" && period.toDate === "" && view === "interview_scheduled" && (
        <p className="mt-3 text-[11.5px] leading-relaxed text-sub">期間を指定しないときは、面接日時が未入力の予定も含みます。期間を指定すると、面接日時が入力されたものだけが対象です。</p>
      )}
      {res === null ? null : !res.ok ? <OpsError reason={res.reason} /> : res.data.rows.length === 0 ? (
        <OpsEmpty>条件に合う進捗はありません。</OpsEmpty>
      ) : (
        <>
          <p className="mt-6 text-[11.5px] text-sub">{VIEW_LABEL[view]}: {res.data.total}件（基準時刻 {fmtJst(res.data.as_of)}）</p>
          <ul className="mt-2 space-y-3">
            {res.data.rows.map((r) => (
              <li key={r.process_id} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-serif text-[15px] font-bold text-ink">{stylistLabel(r)}</span>
                  <span className="rounded-full bg-surface2 px-2 py-0.5 text-[11px] text-charcoal">{HIRING_STATUS_LABELS[r.status] ?? r.status}</span>
                  {r.interview_elapsed_not_updated && <span className="rounded-full bg-[#C24545]/10 px-2 py-0.5 text-[11px] font-semibold text-[#8A2E2E]">面接予定日時を過ぎて結果が未更新</span>}
                </div>
                <p className="mt-1 text-[12.5px] text-charcoal">{r.organization_name} / {r.store_name}</p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px] text-sub">
                  <dt>面接予定</dt><dd className="text-charcoal">{fmtJst(r.interview_at)}{r.interview_type ? `（${INTERVIEW_TYPE_LABELS[r.interview_type] ?? r.interview_type}）` : ""}</dd>
                  <dt>起点</dt><dd className="text-charcoal">{HIRING_SOURCE_LABELS[r.source] ?? r.source}</dd>
                  <dt>最終更新</dt><dd className="text-charcoal">{fmtJst(r.updated_at)}</dd>
                  <dt>最終の履歴</dt><dd className="text-charcoal">{fmtJst(r.last_event_at)}</dd>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/admin/stylists/${r.stylist_user_id}`} className={linkCls}>美容師の詳細</Link>
                  <Link href={`/admin/salons/${r.organization_id}`} className={linkCls}>会社・店舗の詳細</Link>
                  <Link href={contactStylistHref(r.stylist_user_id)} className={linkCls}>美容師へ連絡（既存の連絡機能）</Link>
                  <Link href={contactSalonHref(r.organization_id, r.store_id)} className={linkCls}>サロンへ連絡（既存の連絡機能）</Link>
                </div>
              </li>
            ))}
          </ul>
          <OpsPager total={res.data.total} page={page} basePath="/admin/interviews" params={params} />
        </>
      )}
    </main>
  );
}
