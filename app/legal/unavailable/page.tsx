import Link from "next/link";
import { signOutAction } from "@/lib/auth/actions";
import { safeNextPath } from "@/lib/legal/gate";
import { SubmitButton } from "@/components/auth/submit-button";

type Props = { searchParams: Promise<{ next?: string }> };

/**
 * 規約の確認処理を完了できないときの案内（/legal/unavailable）。
 * 同意状況を確認できない間は、サービス本体へは入れない。この画面自体は確認の対象外なので、
 * 障害中でもループしない。DBのエラー内容は表示しない。
 */
export default async function LegalUnavailablePage({ searchParams }: Props) {
  const { next } = await searchParams;
  const retry = safeNextPath(next);
  return (
    <main className="mx-auto flex min-h-screen max-w-[480px] flex-col justify-center px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <div className="rounded-2xl border border-line bg-surface p-6">
        <h1 className="font-serif text-xl font-bold text-ink">確認処理を完了できません</h1>
        <p className="mt-3 text-[13px] leading-relaxed text-charcoal">
          現在、利用規約の確認処理を完了できません。少し時間をおいて再度お試しください。
        </p>
        <Link href={retry} className="mt-5 flex w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface">
          もう一度試す
        </Link>
        <form action={signOutAction} className="mt-3">
          <SubmitButton pendingText="ログアウト中...">ログアウト</SubmitButton>
        </form>
        <p className="mt-4 text-center text-[12px] text-sub">
          <Link href="/terms" className="underline">利用規約</Link>
          <span className="mx-2">／</span>
          <Link href="/privacy" className="underline">プライバシーポリシー</Link>
        </p>
      </div>
    </main>
  );
}
