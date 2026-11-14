import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/guard";
import { adminListThreads } from "@/lib/messages/rpc";
import { STATUS_LABEL } from "@/lib/messages/shared";
import { PAGE_SIZE, parsePage } from "@/lib/admin/directory";
import { isUuid } from "@/lib/messages/shared";
import { ErrorBox, Pager } from "@/components/admin/directory-ui";

type SP = Promise<Record<string, string | string[] | undefined>>;

/** 運営: 連絡の一覧。権限が外れた担当者宛・通知失敗のスレッドは印を付ける（運営は引き続き閲覧・完了・再開できる）。 */
export default async function AdminMessagesPage({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireAdminPage("/admin/messages");
  const sp = await searchParams;
  const st = typeof sp.status === "string" && sp.status in STATUS_LABEL ? sp.status : "";
  const page = parsePage(sp);
  const org = typeof sp.org === "string" && isUuid(sp.org) ? sp.org : "";
  const res = await adminListThreads(supabase, { status: st || null, organizationId: org || null, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <div className="mb-6 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach Admin</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <h1 className="font-serif text-2xl font-bold text-ink">連絡</h1>
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">サロン・美容師への連絡と返信の履歴です。新しい連絡は、<Link href="/admin/salons" className="underline">会社・店舗</Link>または<Link href="/admin/stylists" className="underline">美容師</Link>の詳細から作成します。通知メールはこの画面からは送信されません。</p>
      <form method="get" className="mt-5 flex gap-2">
        {org && <input type="hidden" name="org" value={org} />}
        <select name="status" defaultValue={st} aria-label="状態" className="min-h-[44px] flex-1 rounded-xl border border-line bg-surface px-3 text-[13px]">
          <option value="">状態（すべて）</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="min-h-[44px] rounded-full bg-ink px-5 text-[13px] font-semibold text-white">絞り込む</button>
      </form>
      {!res.ok ? <ErrorBox reason={res.reason} /> : res.data.rows.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-line bg-surface p-8 text-center text-[13px] text-sub">連絡はありません。</p>
      ) : (
        <>
          <ul className="mt-6 space-y-3">
            {res.data.rows.map((t) => (
              <li key={t.id}><Link href={`/admin/messages/${t.id}`} className="block rounded-2xl border border-line bg-surface p-4 hover:bg-surface2">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                  <span className="rounded-full bg-ink px-2.5 py-0.5 text-white">{t.audience === "salon" ? "サロン宛" : "美容師宛"}</span>
                  <span className="rounded-full border border-line px-2.5 py-0.5">{STATUS_LABEL[t.status] ?? t.status}</span>
                  {t.recipient_access_lost && <span className="rounded-full bg-[#B8892E]/20 px-2.5 py-0.5 text-[#7A5A12]">宛先の担当者は権限なし</span>}
                  {t.delivery_failed && <span className="rounded-full bg-[#C24545]/15 px-2.5 py-0.5 text-[#8A2E2E]">通知失敗</span>}
                </div>
                <p className="mt-2 text-[14px] font-semibold text-ink">{t.subject}</p>
                <p className="mt-1 text-[12px] text-sub">{[t.organization_name, t.store_name].filter(Boolean).join(" / ") || "（美容師宛）"}</p>
              </Link></li>
            ))}
          </ul>
          <Pager total={res.data.total} page={page} basePath="/admin/messages" params={{ ...(st ? { status: st } : {}), ...(org ? { org } : {}) }} />
        </>
      )}
    </main>
  );
}
