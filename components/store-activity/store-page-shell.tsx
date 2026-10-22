import Link from "next/link";

type Props = {
  storeId: string;
  storeName: string;
  eyebrow: string;
  description?: string;
  children: React.ReactNode;
};

/** 店舗workspace配下の履歴・受信画面で共通のヘッダー（既存のstylists画面と同じ見た目）。 */
export function StorePageShell({ storeId, storeName, eyebrow, description, children }: Props) {
  return (
    <main className="mx-auto max-w-[640px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <Link href={`/salon/stores/${storeId}`} className="text-[13px] font-semibold text-sub underline">
        ← {storeName} に戻る
      </Link>

      <p className="eyebrow mb-2 mt-5">{eyebrow}</p>
      <h1 className="font-serif text-2xl font-bold text-ink">{storeName}</h1>
      {description && <p className="mt-3 text-[13px] leading-relaxed text-charcoal">{description}</p>}

      {children}
    </main>
  );
}
