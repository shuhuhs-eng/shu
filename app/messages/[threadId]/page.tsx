import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { inboxGet } from "@/lib/messages/rpc";
import { requestIdFrom } from "@/lib/messages/shared";
import { inboxReplyAction } from "@/lib/messages/actions";
import { MessageForm } from "@/components/messages/message-form";
import { ErrorBox } from "@/components/admin/directory-ui";
import { ThreadMessages } from "@/components/messages/thread-view";

/** 運営からの連絡の詳細と返信。運営内部メモ・記録は、DBが返さないためここには出ない。権限がない・存在しない・内部のみの連絡は同じ「見つかりません」。 */
export default async function MessageThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/messages/${threadId}`)}`);
  const res = await inboxGet(supabase, threadId);
  if (!res.ok) return <main className="mx-auto max-w-[720px] px-5 py-10"><Link href="/messages" className="text-[13px] font-semibold text-sub underline">← 連絡一覧</Link><ErrorBox reason={res.reason === "not_found" ? "not_found" : "error"} /></main>;
  const t = res.data;
  const rid = requestIdFrom(undefined);
  return (
    <main className="mx-auto max-w-[720px] px-5 py-10">
      <Link href="/messages" className="text-[13px] font-semibold text-sub underline">← 連絡一覧</Link>
      <h1 className="mt-3 font-serif text-xl font-bold text-ink">{t.subject}</h1>
      {(t.organization_name || t.store_name) && <p className="mt-1 text-[12px] text-sub">{[t.organization_name, t.store_name].filter(Boolean).join(" / ")}</p>}
      <ThreadMessages items={t.messages.map((m) => ({ id: m.id, body: m.body, at: m.created_at, label: m.author_label, tone: m.from_admin ? "admin" : "them" }))} />
      {t.can_reply ? (
        <MessageForm action={inboxReplyAction} initialRequestId={rid} hidden={{ thread_id: t.id }} submitLabel="返信する" placeholder="返信を入力" note="二重に押しても、同じ内容は1件だけ送られます。" />
      ) : <p className="mt-6 rounded-lg bg-surface2 px-3 py-2 text-[12.5px] text-sub">この連絡は完了しています。</p>}
    </main>
  );
}
