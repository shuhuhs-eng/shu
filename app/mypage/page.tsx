import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRoles } from "@/lib/auth/user-roles";

/**
 * 旧URL。役割別ルーティング分離により、実体は /stylist/mypage・/salon/mypage に
 * 分かれた。複数role対応のため、現在のユーザー状態（ログイン状態・完了済みrole）を
 * 見たうえで、決め打ちせず適切な行き先へ振り分ける。
 *
 *   美容師roleのみ完了 → /stylist/mypage
 *   サロンroleのみ完了 → /salon/mypage
 *   両方完了           → /stylist/mypage（Beauty Reachは診断ファーストのため、
 *                        美容師側を既定の行き先とする。app/page.tsx のHOME
 *                        （ログイン済み時）と同じ優先順位）
 *   どちらも未完了     → /onboarding（美容師オンボーディングへ）
 */
export default async function MyPageRedirect() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/mypage");
  }

  const roles = await getUserRoles(supabase, user.id);

  if (roles.has("stylist")) {
    redirect("/stylist/mypage");
  }
  if (roles.has("salon")) {
    redirect("/salon/mypage");
  }
  redirect("/onboarding");
}
