import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyLegalAcceptanceStatus } from "@/lib/legal/actions";
import { safeNextPath } from "@/lib/legal/gate";
import { signOutAction } from "@/lib/auth/actions";
import { SubmitButton } from "@/components/auth/submit-button";
import { AcceptForm } from "@/components/legal/accept-form";

type Props = { searchParams: Promise<{ next?: string }> };

/**
 * 規約・プライバシーポリシーへの同意（/legal/accept）。
 * 公開中の現在の版に未同意のログイン済みユーザーが、middlewareからここへ誘導される。
 * 同意済み（または公開された版が無い）なら、戻り先へそのまま進む。
 */
export default async function LegalAcceptPage({ searchParams }: Props) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(next);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const status = await getMyLegalAcceptanceStatus();
  if (status === null) {
    return (
      <main className="mx-auto max-w-[480px] px-5 py-12">
        <p className="rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">現在、利用規約の確認処理を完了できません。少し時間をおいて再度お試しください。</p>
        <form action={signOutAction} className="mt-4"><SubmitButton pendingText="ログアウト中...">ログアウト</SubmitButton></form>
      </main>
    );
  }
  if (status.accepted) redirect(nextPath);

  const labels = status.pending.map((p) => p.title);
  return (
    <main className="mx-auto flex min-h-screen max-w-[480px] flex-col justify-center px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <div className="rounded-2xl border border-line bg-surface p-6">
        <h1 className="font-serif text-xl font-bold text-ink">規約への同意のお願い</h1>
        <p className="mt-3 text-[13px] leading-relaxed text-charcoal">
          Beauty Reachをご利用いただくには、次の内容へのご同意が必要です。内容を開いてご確認ください。
        </p>
        <ul className="mt-4 space-y-2 text-[13px]">
          {status.pending.map((p) => (
            <li key={p.document_type}>
              <Link href={p.document_type === "terms" ? "/terms" : "/privacy"} target="_blank" rel="noopener noreferrer"
                className="font-semibold text-ink underline">{p.title}（版 {p.version}）</Link>
            </li>
          ))}
        </ul>
        <AcceptForm next={nextPath} labels={labels} />
        <form action={signOutAction} className="mt-3">
          <SubmitButton pendingText="ログアウト中...">同意せずにログアウト</SubmitButton>
        </form>
      </div>
    </main>
  );
}
