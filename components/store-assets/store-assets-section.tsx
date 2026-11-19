import { SALON_LINK_TYPE_LABELS } from "@/lib/validation/salon-links";
import { STORE_PHOTO_DESCRIPTION, STORE_PHOTO_FRAME_CLASS, STORE_PHOTO_GRID_CLASS, STORE_PHOTO_IMAGE_CLASS, STORE_PHOTO_TITLE } from "@/lib/store-assets/constants";
import type { StoreAssetsData } from "@/lib/store-assets/parse";

/**
 * 店舗の写真・リンクの表示（表示専用。美容師向け店舗詳細・プレビュー・閲覧のみの担当者の編集画面で共用）。
 * ・見出しは「お店の雰囲気」に統一。分類名・説明・タブは出さない（登録順＝並び順の1つの一覧）。
 * ・スマートフォンも広い画面も、1枚ずつ横幅いっぱいの大きな枠（小さなサムネイルを並べない）。縦横比は 4:3 に統一し、切り抜いて表示する（引き伸ばさない）。
 * ・ロゴは写真の一覧には含めない（店名の左に小さく表示する: StoreNameWithLogo）。
 * 何も登録されていないときは何も表示しない（枠だけの空欄を出さない）。
 * 画像は署名付きURL（有効期限は lib/store-assets/constants.ts）。取得できなかった画像は表示しない。
 */
export function StoreAssetsSection({ assets }: { assets: StoreAssetsData | null }) {
  const photos = (assets?.photos ?? []).filter((p) => p.url);
  const links = assets?.links ?? [];
  if (!assets || (photos.length === 0 && links.length === 0)) return null;

  return (
    <section className="mt-5 rounded-2xl border border-line bg-surface p-6" aria-label={`${STORE_PHOTO_TITLE}とリンク`}>
      {photos.length > 0 && (
        <div>
          <h2 className="eyebrow">{STORE_PHOTO_TITLE}</h2>
          <p className="mb-3 mt-1 text-[12px] leading-relaxed text-sub">{STORE_PHOTO_DESCRIPTION}</p>
          <ul className={STORE_PHOTO_GRID_CLASS}>
            {photos.map((p) => (
              <li key={p.id} className={STORE_PHOTO_FRAME_CLASS}>
                {/* eslint-disable-next-line @next/next/no-img-element -- 署名付きURLをそのまま表示するため */}
                <img src={p.url!} alt={STORE_PHOTO_TITLE} className={STORE_PHOTO_IMAGE_CLASS} loading="lazy" />
              </li>
            ))}
          </ul>
        </div>
      )}
      {links.length > 0 && (
        <div className={photos.length > 0 ? "mt-5 border-t border-line pt-4" : ""}>
          <p className="eyebrow mb-2">リンク</p>
          <ul className="space-y-2">
            {links.map((l) => (
              <li key={l.id}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-[44px] w-full items-center justify-center rounded-full border border-line bg-surface2 px-5 py-2.5 text-[13px] font-semibold text-ink"
                >
                  {l.label || SALON_LINK_TYPE_LABELS[l.linkType]}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
