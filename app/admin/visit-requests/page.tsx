import Link from "next/link";
import { requireAdminOperator } from "@/lib/admin/operator-guard";
import { parseOpsPage } from "@/lib/admin/operations";
import { listVisitRequests, parseVisitFilters } from "@/lib/admin/visit-requests";
import { ENTRANCE_LABELS, KIND_LABELS, STATUS_LABELS, CONFIRM_LABELS, SOURCE_CANCELLED_TEXT, VISIT_ENTRANCES, VISIT_KINDS, VISIT_LIST_STATUSES } from "@/lib/admin/visit-requests-shared";
import { contactSalonHref, contactStylistHref, fmtJst, linkCls, OpsEmpty, OpsError, OpsPager, PageHead, stylistLabel } from "@/components/admin/operations-ui";
import { VisitRequestClaimButton } from "@/components/admin/visit-request-claim-button";

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * 運営: 見学・体験入店の受付一覧（0087 草案の RPC を使う）。
 * 入口（スカウト返信／美容師から店舗への直接の希望）と希望種別（見学／体験入店）を区別して表示する。
 * 過去の「話を聞いてみたい」は見学・体験入店に読み替えず、「過去の返信」の絞り込みでだけ読み取り表示（受付はできない）。
 * ★受付・状態変更はカード請求・決済・スカウト消費を行わない。「実施済み」遷移時のみ0108のトリガで見学料の請求記録（未払い）が作られる（支払いの確定ではない）。
 */
export default async function AdminVisitRequestsPage({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireAdminOperator("/admin/visit-requests");
  const sp = await searchParams;
  const f = parseVisitFilters(sp), page = parseOpsPage(sp);
  const res = await listVisitRequests(supabase, { ...f, page });
  const params: Record<string, string> = {};
  if (f.entrance) params.entrance = f.entrance;
  if (f.kind) params.kind = f.kind;
  if (f.status) params.status = f.status;
  if (f.legacy) params.legacy = "1";
  const sel = "min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 text-[13px]";
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <PageHead
        title="見学・体験入店の受付"
        lead={<>スカウトへの返信と、美容師から店舗への直接希望（見学・体験入店）を、入口と希望種別を分けて確認します。<b>受付しても日程や参加は確定しません</b>。カード請求・決済は行われません。双方の実施確認の記録後に「実施済み」にすると見学料の請求記録（未払い）が自動で作られます（利用者への通知なし）。実際の支払いは実施後に双方へ確認し、運営が別途手動で記録します。連絡は既存の連絡機能で行います。</>}
      />
      <form method="get" className="mt-5 grid gap-3 rounded-2xl border border-line bg-surface p-4">
        <select name="entrance" defaultValue={f.entrance} className={sel} aria-label="入口">
          <option value="">入口（すべて）</option>{VISIT_ENTRANCES.map((v) => <option key={v} value={v}>{ENTRANCE_LABELS[v]}</option>)}
        </select>
        <select name="kind" defaultValue={f.kind} className={sel} aria-label="希望種別">
          <option value="">希望種別（すべて）</option>{VISIT_KINDS.map((v) => <option key={v} value={v}>{KIND_LABELS[v]}</option>)}
        </select>
        <select name="status" defaultValue={f.status} className={sel} aria-label="状態">
          <option value="">状態（すべて）</option>{VISIT_LIST_STATUSES.map((v) => <option key={v} value={v}>{STATUS_LABELS[v]}</option>)}
        </select>
        <label className="flex min-h-[44px] items-center gap-2 text-[12.5px] text-charcoal"><input type="checkbox" name="legacy" value="1" defaultChecked={f.legacy} />過去の返信（以前の「話を聞いてみたい」）も表示する</label>
        <button className="min-h-[44px] rounded-full bg-ink px-5 text-[13px] font-semibold text-white">絞り込む</button>
      </form>
      {!res.ok ? <OpsError reason={res.reason} /> : res.data.rows.length === 0 ? <OpsEmpty>条件に合う受付はありません。</OpsEmpty> : (
        <>
          <p className="mt-6 text-[11.5px] text-sub">{res.data.total}件（基準時刻 {fmtJst(res.data.as_of)}）</p>
          <ul className="mt-2 space-y-3">
            {res.data.rows.map((r) => (
              <li key={`${r.entrance}-${r.source_id}`} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-serif text-[15px] font-bold text-ink">{stylistLabel(r)}</span>
                  {r.legacy_interested ? (
                    <span className="rounded-full bg-surface2 px-2 py-0.5 text-[11px] text-charcoal">過去の返信（話を聞いてみたい）</span>
                  ) : (
                    <>
                      <span className="rounded-full bg-[#EAF3EC] px-2 py-0.5 text-[11px] font-semibold text-[#1F5A3F]">{r.kind ? KIND_LABELS[r.kind] : "—"}</span>
                      <span className={r.status === "unclaimed" ? "rounded-full bg-[#C24545]/10 px-2 py-0.5 text-[11px] font-semibold text-[#8A2E2E]" : "rounded-full bg-surface2 px-2 py-0.5 text-[11px] text-charcoal"}>{STATUS_LABELS[r.status] ?? r.status}</span>
                    </>
                  )}
                </div>
                <p className="mt-1 text-[12.5px] text-charcoal">{r.organization_name} / {r.store_name}</p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px] text-sub">
                  <dt>入口</dt><dd className="text-charcoal">{ENTRANCE_LABELS[r.entrance] ?? r.entrance}</dd>
                  <dt>希望の日時</dt><dd className="text-charcoal">{fmtJst(r.requested_at)}</dd>
                  {r.scheduled_on && (<><dt>実施日</dt><dd className="text-charcoal">{r.scheduled_on}</dd></>)}
                  {(r.salon_confirmation || r.stylist_confirmation) && (<><dt>実施後の確認</dt><dd className="text-charcoal">サロン: {r.salon_confirmation ? CONFIRM_LABELS[r.salon_confirmation] : "未確認"} / 本人: {r.stylist_confirmation ? CONFIRM_LABELS[r.stylist_confirmation] : "未確認"}</dd></>)}
                  {r.source_cancelled && (<><dt>入口の希望</dt><dd className="font-semibold text-[#8A2E2E]">{SOURCE_CANCELLED_TEXT}</dd></>)}
                  {r.has_note && (<><dt>内部メモ</dt><dd className="text-charcoal">あり（詳細で確認）</dd></>)}
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.request_id ? <Link href={`/admin/visit-requests/${r.request_id}`} className={linkCls}>詳細・更新</Link>
                    : r.legacy_interested ? <span className="text-[11.5px] text-sub">過去の返信は見学・体験入店の希望として受付できません（連絡は下のリンクから）。</span>
                    : <VisitRequestClaimButton sourceKind={r.entrance as "scout_reply" | "direct_interest"} sourceId={r.source_id} />}
                  <Link href={`/admin/stylists/${r.stylist_user_id}`} className={linkCls}>美容師の詳細</Link>
                  <Link href={contactStylistHref(r.stylist_user_id)} className={linkCls}>美容師へ連絡（既存の連絡機能）</Link>
                  <Link href={contactSalonHref(r.organization_id, r.store_id)} className={linkCls}>サロンへ連絡（既存の連絡機能）</Link>
                </div>
              </li>
            ))}
          </ul>
          <OpsPager total={res.data.total} page={page} basePath="/admin/visit-requests" params={params} />
        </>
      )}
    </main>
  );
}
