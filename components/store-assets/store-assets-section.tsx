import { SALON_LINK_TYPE_LABELS } from "@/lib/validation/salon-links";
import { hasAnyStoreAsset, type StoreAssetsData } from "@/lib/store-assets/parse";

/**
 * 店舗別のロゴ・写真・リンクの表示（表示専用。美容師向け店舗詳細・プレビュー・閲覧のみの担当者の編集画面で共用）。
 * 何も登録されていないときは何も表示しない（枠だけの空欄を出さない）。
 * 画像は署名付きURL（有効期限は lib/store-assets/constants.ts）。取得できなかった画像は表示しない。
 */
export function StoreAssetsSection({ assets }: { assets: StoreAssetsData | null }) {
  if (!assets || !hasAnyStoreAsset(assets)) return null;
  const photos = (category: "interior" | "atmosphere") => assets.photos.filter((p) => p.category === category && p.url);
  const groups: { key: "interior" | "atmosphere"; label: string }[] = [
    { key: "interior", label: "店内の様子" },
    { key: "atmosphere", label: "スタッフ・サロンの雰囲気" },
  ];

  return (
    <section className="mt-5 rounded-2xl border border-line bg-surface p-6" aria-label="店舗の写真とリンク">
      {assets.logoUrl && (
        <div className="mb-4 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- 署名付きURLをそのまま表示するため */}
          <img src={assets.logoUrl} alt="店舗ロゴ" className="h-20 w-20 rounded-2xl border border-line object-contain" />
        </div>
      )}
      {groups.map(({ key, label }) =>
        photos(key).length > 0 ? (
          <div key={key} className="mt-4 first:mt-0">
            <p className="eyebrow mb-2">{label}</p>
            <div className="grid grid-cols-3 gap-2">
              {photos(key).map((p) => (
                <div key={p.id} className="aspect-square overflow-hidden rounded-xl border border-line bg-surface2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- 署名付きURLをそのまま表示するため */}
                  <img src={p.url!} alt="" className="h-full w-full object-cover" loading="lazy" />
                </div>
              ))}
            </div>
          </div>
        ) : null,
      )}
      {assets.links.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="eyebrow mb-2">リンク</p>
          <ul className="space-y-2">
            {assets.links.map((l) => (
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
