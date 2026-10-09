import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";

/**
 * 旧「美容師を探す」画面（/salon/stylists、auth.uid()ベース・旧send_scout）。
 *
 * ★法人・複数店舗対応 Phase 5での方針転換: send_scout_v2導入に伴い、
 * 旧send_scout経由のScout送信と新organization_scout_quotaが並走すると
 * quotaが実質二重枠になってしまう（0034のコメント参照）。これを防ぐため、
 * このページ自体でのScout送信UIは廃止し、店舗workspace側の新画面
 * （/salon/stores/[storeId]/stylists、send_scout_v2使用）へ案内する
 * リダイレクトのみを行う。
 *
 * ★store_idの推測禁止: このページ自体にはstoreIdの情報が無いため、
 * salon_onboarding_assignments等から「たぶんこの店舗」と推測して
 * 自動的にScout送信画面へ直接送り込むことはしない。
 *   - アクセス可能な店舗がちょうど1件の場合のみ、その店舗のstylists画面へ
 *     自動的にリダイレクトする（salon_storesへの直接SELECT、RLS
 *     salon_stores_select_accessibleがis_store_accessible()で絞り込んだ
 *     結果が1件、という事実に基づく判断であり、推測ではない）。
 *   - 0件・2件以上の場合は/salon/companyへ案内し、ユーザー自身に店舗を
 *     選んでもらう。
 *
 * ★旧send_scout RPC・旧sendScout Server Action（lib/scouts/actions.ts）
 * 自体は削除していない。このページが本番導線から外れることで、
 * 実ユーザーがそこへ到達する経路が無くなる、という形で呼び出しを停止する。
 */
export default async function SalonStylistsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/salon/stylists");
  }

  if (!(await hasCompletedRole(supabase, user.id, "salon"))) {
    redirect("/onboarding/salon");
  }

  const { data: stores } = await supabase.from("salon_stores").select("id");
  const storeList = stores ?? [];

  if (storeList.length === 1) {
    redirect(`/salon/stores/${storeList[0].id}/stylists`);
  }

  redirect("/salon/company");
}
