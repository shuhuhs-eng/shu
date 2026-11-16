import type { MetadataRoute } from "next";
import { getSeoBaseUrl } from "@/lib/seo/site";

/**
 * 公開ページの巡回を許可し、sitemap.xml を案内する。
 * ・検索対象外のページは noindex（メタ/X-Robots-Tag。lib/seo/noindex-paths.mjs）で制御する。noindex を読み取らせる必要があるため、
 *   それらのパスを robots.txt で一律に巡回禁止にはしない。
 * ・robots.txt は情報保護の手段ではない。ログイン必須ページの認証は proxy.ts・各ページ・DBが行う。
 * ・巡回を禁止するのは、HTMLページではない API と認証コールバックだけ。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/auth/"] },
    sitemap: `${getSeoBaseUrl()}/sitemap.xml`,
  };
}
