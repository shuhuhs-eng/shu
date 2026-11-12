import Link from "next/link";

/** サロンらしさの結果の取得に失敗したとき（未回答とは区別する）。 */
export function CultureResultLoadError({ retryHref, backHref }: { retryHref: string; backHref: string }) {
  return (
    <main className="mx-auto max-w-[560px] px-5 py-12 text-center">
      <p className="text-[14px] leading-relaxed text-charcoal">
        サロンらしさの結果を読み込めませんでした。回答が失われたわけではありません。もう一度お試しください。
      </p>
      <Link href={retryHref} className="mt-5 inline-block text-[13px] font-semibold text-ink underline">
        再読み込みする
      </Link>
      <div className="mt-3">
        <Link href={backHref} className="text-[13px] text-sub underline">
          戻る
        </Link>
      </div>
    </main>
  );
}
