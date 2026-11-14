import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { inboxList } from "@/lib/messages/rpc";
import { parsePage, PAGE_SIZE } from "@/lib/admin/directory";
import { InboxCard } from "@/components/messages/cards";
import { ErrorBox, Pager } from "@/components/admin/directory-ui";

type SP = Promise<Record<string, string | string[] | undefined>>;

/** サロン・美容師共通: 運営からの連絡一覧。表示する連絡の範囲はDBが現在の権限で決める（サロンは担当店舗の店長・採用担当／会社の管理者のみ）。 */
export default async function MessagesPage({ searchParams }: { searchParams: SP }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/messages");
  const page = parsePage(await searchParams);
  const res = await inboxList(supabase, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  return (
    <main className="mx-auto max-w-[720px] px-5 py-10">
      <h1 className="font-serif text-2xl font-bold text-ink">運営からの連絡</h1>
      {!res.ok ? <ErrorBox reason={res.reason === "forbidden" ? "forbidden" : "error"} /> : res.data.rows.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-line bg-surface p-8 text-center text-[13px] text-sub">連絡はありません。</p>
      ) : (
        <>
          <ul className="mt-6 space-y-3">
            {res.data.rows.map((t) => (
              <li key={t.id}><InboxCard t={t} /></li>
            ))}
          </ul>
          <Pager total={res.data.total} page={page} basePath="/messages" params={{}} />
        </>
      )}
    </main>
  );
}
