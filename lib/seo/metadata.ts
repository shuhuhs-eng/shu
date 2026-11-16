import type { Metadata } from "next";
import { OG_IMAGE, SITE_NAME } from "@/lib/seo/site";

/**
 * 公開ページのメタデータ。canonical はそのページ自身のパス（トップに寄せない）。
 * Next.js は openGraph / robots などのネストした項目を「後勝ちで丸ごと置き換え」るため、ページごとに openGraph も完全な形で作る。
 */
export function publicPageMetadata(opts: { title: string; description: string; path: string }): Metadata {
  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical: opts.path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "ja_JP",
      title: opts.title,
      description: opts.description,
      url: opts.path,
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: opts.title,
      description: opts.description,
      images: [OG_IMAGE.url],
    },
  };
}

/** 検索対象外ページ用（noindex）。canonical は付けない。 */
export const NOINDEX_METADATA: Metadata = {
  robots: { index: false, follow: false },
};
