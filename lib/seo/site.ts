import { getSiteUrl } from "@/lib/site-url";

export const SITE_NAME = "Beauty Reach";
export const SITE_TAGLINE = "才能を、多彩に評価する。";
export const SITE_DESCRIPTION = "美容師の才能を診断し、相性の合うサロンと出会う。";

/** 本番URLが環境変数で取れないとき（ビルド時など）の最終手段。通常は NEXT_PUBLIC_SITE_URL を使う。 */
const FALLBACK_SITE_URL = "https://beautyreach.jp";

/** SEO（canonical・OGP・sitemap）の基点URL。末尾スラッシュなし。 */
export function getSeoBaseUrl(): string {
  try {
    return getSiteUrl();
  } catch {
    return FALLBACK_SITE_URL;
  }
}

/** OGP画像（既存素材 public/brand/logo.jpg。1206×776）。 */
export const OG_IMAGE = {
  url: "/brand/logo.jpg",
  width: 1206,
  height: 776,
  alt: "Beauty Reach — 才能を、多彩に評価する。",
} as const;
