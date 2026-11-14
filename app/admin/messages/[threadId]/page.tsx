import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/guard";
import { adminGetThread } from "@/lib/messages/rpc";
import { STATUS_LABEL, REOPEN_STATUSES, requestIdFrom } from "@/lib/messages/shared";
import { postAdminMessageAction, setThreadStatusAction } from "@/lib/messages/actions";
import { ErrorBox } from "@/components/admin/directory-ui";
import { FormError, ThreadMessages, adminItems } from "@/components/messages/thread-view";

type SP = Promise<Record<string, string | string[] | undefined>>;

/** 運営: 連絡の詳細。宛先の担当者が権限を失っていても、運営は閲覧・投稿・完了・再開できる（相手側は閲覧・返信できなくなる）。 */
export default async function AdminThreadPage({ params, searchParams }: { params: Promise<{ threadId: string }>; searchParams: SP }) {
  const { threadId } = await params;
  const { supabase } = await requireAdminPage(`/admin/messages/${threadId}`);
  const sp = await searchParams;
  const res = await adminGetThread(supabase, threadId);
  if (!res.ok) return <main className="mx-auto max-w-[900px] px-5 py-10"><Link href="/admin/messages" className="text-[13px] font-semibold text-sub underline">← 連絡</Link><ErrorBox reason={res.reason} /></main>;
  const { thread: t, messages } = res.data;
  const rid = requestIdFrom(sp.rid);
  const err = typeof sp.err === "string" ? sp.err : undefined;
  const field = "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[13.5px]";
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <Link href="/admin/messages" className="text-[13px] font-semibold text-sub underline">← 連絡</Link>
      <h1 className="mt-3 font-serif text-xl font-bold text-ink">{t.subject}</h1>
      <p className="mt-1 text-[12px] text-sub">{t.audience === "salon" ? "サロン宛" : "美容師宛"} ／ 状態: {STATUS_LABEL[t.status] ?? t.status}</p>
      {t.recipient_access_lost && <p className="mt-3 rounded-lg bg-[#B8892E]/15 px-3 py-2 text-[12.5px] text-[#7A5A12]">宛先に指定した担当者は、異動・退任などでこの会社・店舗の連絡を見る権限がなくなりました。その担当者は閲覧・返信できません。{t.salon_reader_count != null && `現在この連絡を見られるサロン側の担当者は${t.salon_reader_count}名です。`}</p>}
      {t.audience === "salon" && t.salon_reader_count === 0 && <p className="mt-3 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12.5px] text-[#8A2E2E]">この連絡を見られるサロン側の担当者がいません。電話など別の方法での連絡を検討してください。</p>}
      <ThreadMessages items={adminItems(messages)} />
      <FormError err={err} />

      <form action={postAdminMessageAction} className="mt-6 grid gap-3 rounded-2xl border border-line bg-surface p-4">
        <input type="hidden" name="rid" value={rid} /><input type="hidden" name="thread_id" value={t.id} />
        <select name="kind" aria-label="種類" className={field} defaultValue="to_recipient">
          <option value="to_recipient">相手に送信（相手に見えます）</option>
          <option value="internal_note">運営内部メモ（相手には見えません）</option>
          <option value="offline_log">電話・対面などの記録（相手には見えません）</option>
        </select>
        <textarea name="body" required maxLength={4000} rows={5} aria-label="本文" className={field} />
        <button className="min-h-[44px] rounded-full bg-ink px-5 text-[13px] font-semibold text-white">追加する</button>
        <p className="text-[11px] text-sub">二重に押しても、同じ内容は1件だけ保存されます。通知メールは送信されません。</p>
      </form>

      <div className="mt-6 grid gap-3 rounded-2xl border border-line bg-surface p-4">
        {t.status !== "done" ? (
          <form action={setThreadStatusAction} className="flex items-center gap-3">
            <input type="hidden" name="thread_id" value={t.id} /><input type="hidden" name="status" value="done" />
            <button className="min-h-[44px] rounded-full border border-line px-5 text-[13px] font-semibold">完了にする</button>
          </form>
        ) : (
          <form action={setThreadStatusAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="thread_id" value={t.id} />
            <select name="status" aria-label="再開後の状態" className="min-h-[44px] rounded-xl border border-line bg-surface px-3 text-[13px]">
              {REOPEN_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
            <button className="min-h-[44px] rounded-full border border-line px-5 text-[13px] font-semibold">再開する</button>
          </form>
        )}
      </div>
    </main>
  );
}
