/**
 * 店名の左に添える小さな店舗ロゴ（表示専用。美容師向け店舗詳細・プレビューで共用）。
 * 目立ちすぎないよう 40px 角に抑え、店名より小さく控えめに置く。ロゴ未登録（または画像を取得できない）ときは何も出さず、店名だけの表示になる
 * （余白や空の枠を残さないので、レイアウトは崩れない）。写真の一覧とは別の部品で、写真の枚数には数えない。
 */
export function StoreNameWithLogo({ name, logoUrl, className }: { name: string; logoUrl: string | null | undefined; className?: string }) {
  return (
    <div className="flex items-center gap-3">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- 署名付きURLをそのまま表示するため
        <img src={logoUrl} alt={`${name}のロゴ`} className="h-10 w-10 shrink-0 rounded-lg border border-line bg-surface object-contain" />
      ) : null}
      <h1 className={className ?? "min-w-0 break-words font-serif text-2xl font-bold text-ink"}>{name}</h1>
    </div>
  );
}
