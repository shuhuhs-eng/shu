import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/guard";
import { listStoreInterests, parseInterestProgress, parseOpsPage, parsePeriod } from "@/lib/admin/operations";
import { HIRING_SOURCE_LABELS, HIRING_STATUS_LABELS } from "@/lib/hiring/format";
import { contactSalonHref, contactStylistHref, fmtJst, linkCls, OpsEmpty, OpsError, OpsPager, PageHead, PeriodFields, stylistLabel } from "@/components/admin/operations-ui";

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * 運営: 「話を聞いてみたい」（関心）の一覧（読み取り専用）。0085 の admin_list_store_interests を使う。
 * ★状態は「進捗未作成」「進捗作成済み」。「返信済み」とは呼ばない。進捗の作成は、連絡や返信が行われたことを意味しない。
 * ★関心から進捗を作る操作でスカウトは消費されない（既存仕様。ここでは何も操作しない）。
 */
export default async function AdminInterestsPage({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireAdminPage("/admin/interests");
  const sp = await searchParams;
  const progress = parseInterestProgress(sp), period = parsePeriod(sp), page = parseOpsPage(sp);
  const res = period.invalid ? null : await listStoreInterests(supabase, { progress, period, page });
  const params: Record<string, string> = {};
  if (progress) params.progress = progress;
  if (period.fromDate) params.from = period.fromDate;
  if (period.toDate) params.to = period.toDate;
  const sel = "min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 text-[13px]";
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <PageHead
        title="「話を聞いてみたい」の一覧"
        lead={<>美容師が店舗に送った「話を聞いてみたい」を確認します。<b>進捗作成済み</b>は、同じ店舗×美容師の採用進捗が作られているという意味で、<b>連絡や返信が行われたという意味ではありません</b>。自動の通知・督促は行いません。</>}
      />
      <form method="get" className="mt-5 grid gap-3 rounded-2xl border border-line bg-surface p-4">
        <select name="progress" defaultValue={progress} className={sel} aria-label="進捗の状態">
          <option value="">進捗（すべて）</option>
          <option value="not_created">進捗未作成</option>
          <option value="created">進捗作成済み</option>
        </select>
        <PeriodFields period={period} label="期間（送信日）" />
        <button className="min-h-[44px] rounded-full bg-ink px-5 text-[13px] font-semibold text-white">絞り込む</button>
      </form>
      {res === null ? null : !res.ok ? <OpsError reason={res.reason} /> : (
        <>
          {res.data.legacy_rows_without_store > 0 && (
            <p className="mt-4 rounded-lg bg-surface2 px-3 py-2 text-[11.5px] leading-relaxed text-sub">店舗が特定できない旧形式の「話を聞いてみたい」が {res.data.legacy_rows_without_store}件あります。この一覧には含めていません。</p>
          )}
          {res.data.rows.length === 0 ? <OpsEmpty>条件に合う「話を聞いてみたい」はありません。</OpsEmpty> : (
            <>
              <p className="mt-6 text-[11.5px] text-sub">{res.data.total}件（基準時刻 {fmtJst(res.data.as_of)}）</p>
              <ul className="mt-2 space-y-3">
                {res.data.rows.map((r) => (
                  <li key={r.interest_id} className="rounded-2xl border border-line bg-surface p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-serif text-[15px] font-bold text-ink">{stylistLabel(r)}</span>
                      <span className={r.progress_state === "created" ? "rounded-full bg-surface2 px-2 py-0.5 text-[11px] text-charcoal" : "rounded-full bg-[#C24545]/10 px-2 py-0.5 text-[11px] font-semibold text-[#8A2E2E]"}>
                        {r.progress_state === "created" ? "進捗作成済み" : "進捗未作成"}
                      </span>
                    </div>
                    <p className="mt-1 text-[12.5px] text-charcoal">{r.organization_name} / {r.store_name}</p>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px] text-sub">
                      <dt>送信日時</dt><dd className="text-charcoal">{fmtJst(r.created_at)}</dd>
                      {r.progress_state === "created" && (<><dt>進捗の状態</dt><dd className="text-charcoal">{HIRING_STATUS_LABELS[r.process_status ?? ""] ?? r.process_status ?? "—"}</dd>
                        <dt>進捗の起点</dt><dd className="text-charcoal">{HIRING_SOURCE_LABELS[r.process_source ?? ""] ?? r.process_source ?? "—"}</dd></>)}
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
              <OpsPager total={res.data.total} page={page} basePath="/admin/interests" params={params} />
            </>
          )}
        </>
      )}
    </main>
  );
}
