import Link from "next/link";
import type { ReactNode } from "react";

/** error.tsx / not-found.tsx 共通の見た目。技術的な詳細（エラー本文）は表示しない。 */
export function StatusPanel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-[480px] flex-col justify-center px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <div className="rounded-2xl border border-line bg-surface p-6">
        <h1 className="font-serif text-xl font-bold text-ink">{title}</h1>
        <div className="mt-3 text-[13px] leading-relaxed text-charcoal">{children}</div>
        <div className="mt-5 flex flex-col gap-3">
          {action}
          <Link href="/" className="text-center text-[13px] text-sub underline">トップへ戻る</Link>
        </div>
      </div>
    </main>
  );
}
