import { createClient } from "@/lib/supabase/server";
import { AdminNav } from "@/components/admin/admin-nav";
import { NOINDEX_METADATA } from "@/lib/seo/metadata";

// 検索対象外（noindex）。巡回は robots.txt で禁止せず、noindex を読み取らせる。
export const metadata = NOINDEX_METADATA;

/**
 * 運営画面の共通レイアウト。ナビは運営者(is_platform_admin)にだけ表示する。
 * ★各ページも自分で権限を確認する（ここは表示の出し分けだけで、権限の本体ではない）。
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isAdmin = user ? (await supabase.rpc("is_platform_admin")).data === true : false;
  return (
    <>
      {isAdmin && <AdminNav />}
      {children}
    </>
  );
}
