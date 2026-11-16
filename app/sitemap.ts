import type { MetadataRoute } from "next";
import { PUBLIC_INDEXABLE_PATHS } from "@/lib/seo/noindex-paths.mjs";
import { getSeoBaseUrl } from "@/lib/seo/site";

/**
 * 実在する公開ページだけを載せる。マイページ・管理画面・登録/認証・個人の診断結果は含めない。
 * 追加するときは lib/seo/noindex-paths.mjs の PUBLIC_INDEXABLE_PATHS に足す（noindex 対象と重複するとテストが失敗する）。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSeoBaseUrl();
  return PUBLIC_INDEXABLE_PATHS.map((path) => ({ url: path === "/" ? base : `${base}${path}` }));
}
