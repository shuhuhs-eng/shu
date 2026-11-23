import { createClient } from "@/lib/supabase/server";
import { getOperatorState } from "@/lib/admin/operator";
import { AdminNav } from "@/components/admin/admin-nav";
import { NOINDEX_METADATA } from "@/lib/seo/metadata";

// 検索対象外（noindex）。巡回は robots.txt で禁止せず、noindex を読み取らせる。
export const metadata = NOINDEX_METADATA;

/**
 * 運営画面の共通レイアウト。ナビは責任者(is_platform_admin)と有効なスタッフにだけ表示する（スタッフには通常業務の画面だけ）。
 * ★各ページも自分で権限を確認する（ここは表示の出し分けだけで、権限の本体ではない）。
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const state = user ? await getOperatorState(supabase) : "none";
  return (
    <>
      {state === "responsible" && <AdminNav />}
      {state === "staff_active" && <AdminNav variant="staff" />}
      {children}
    </>
  );
}
