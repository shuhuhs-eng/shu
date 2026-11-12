import Link from "next/link";
import { StoreDetailView } from "@/components/stylist-salons/store-detail-view";
import type { StorePreviewResult } from "@/lib/store-preview/load";

type Props = {
  storeId: string;
  result: Extract<StorePreviewResult, { status: "ok" } | { status: "no_profile" }>;
};

/**
 * 「美容師からの見え方（プレビュー）」の本体（表示のみ）。取得・認可は page 側で済んでいる。
 * 美容師向け店舗詳細と同じ表示部品（StoreDetailView）を使う。操作・副作用は持たない。
 */
export function StorePreviewBody({ storeId, result }: Props) {
  const editHref = `/salon/stores/${storeId}/profile`;
  const storeName = result.status === "ok" ? result.store.store_name : result.storeName;

  return (
    <main className="mx-auto max-w-[640px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <section className="rounded-2xl border border-line bg-surface2 p-5">
        <p className="eyebrow mb-1">美容師からの見え方（プレビュー）</p>
        <h1 className="font-serif text-xl font-bold text-ink">{storeName}</h1>
        <p className="mt-2 text-[12px] leading-relaxed text-sub">
          保存済みの内容を表示しています。編集中で未保存の内容は反映されません。
        </p>
        {result.status === "ok" &&
          (result.visibility === "PUBLIC" ? (
            <p className="mt-1.5 text-[12px] leading-relaxed text-sub">この店舗は、美容師に公開されています。</p>
          ) : (
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink">
              この店舗は現在、美容師には公開されていません（公開設定が「公開」ではありません）。公開すると、以下の内容で表示されます。
            </p>
          ))}
        <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
          <Link
            href={editHref}
            className="flex flex-1 items-center justify-center rounded-full bg-ink px-5 py-3 text-[13.5px] font-semibold text-surface"
          >
            プロフィールを編集する
          </Link>
          <Link
            href="/salon/mypage"
            className="flex flex-1 items-center justify-center rounded-full border border-line bg-surface px-5 py-3 text-[13.5px] font-semibold text-ink"
          >
            マイページへ戻る
          </Link>
        </div>
      </section>

      {result.status === "no_profile" ? (
        <section className="mt-5 rounded-2xl border border-line bg-surface p-6 text-center">
          <p className="text-[13.5px] leading-relaxed text-charcoal">
            この店舗のプロフィールは、まだ保存されていません。保存すると、美容師からの見え方を確認できます。
          </p>
        </section>
      ) : (
        <StoreDetailView
          store={result.store}
          employeeSizeLabel={result.employeeSizeLabel}
          matchSection={
            <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
              <p className="eyebrow mb-3 text-center">あなたらしさ × サロンらしさ</p>
              <p className="text-center text-[12.5px] leading-relaxed text-charcoal">
                相性は美容師の回答によって変わります。
              </p>
              <p className="mt-1.5 text-center text-[11.5px] leading-relaxed text-sub">
                プレビューでは、相性の数値は表示しません。
              </p>
            </section>
          }
        />
      )}

      <p className="mt-6 text-center text-[11.5px] leading-relaxed text-sub">
        プレビューでは、「話を聞いてみたい」などの操作はできません。この画面を見ても、美容師への通知や閲覧の記録は発生しません。
      </p>
    </main>
  );}
