import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMypagePath } from "@/lib/auth/mypage-path";
import { StatusPanel } from "@/components/error-panel";

/**
 * サイト共通の「マイページ」。行き先は resolveMypagePath（運営者の判定を含む共通処理）で決める。
 *   運営者 → /admin ／ 美容師 → /stylist/mypage ／ サロン → /salon/mypage ／ どちらも未完了 → /onboarding
 * 運営者かどうか・roleを確認できなかったときは、美容師・オンボーディングへ送らず、再試行できるエラーを表示する。
 * （旧URLの役割別ルーティング分離の経緯: 実体は /stylist/mypage・/salon/mypage。
 *   両方完了の場合は /stylist/mypage を既定とする。app/page.tsx のHOMEと同じ優先順位。）
 */
export default async function MyPageRedirect() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/mypage");
  }

  const target = await resolveMypagePath(supabase, user.id);
  if (target.ok) redirect(target.path);

  return (
    <StatusPanel
      title="マイページを開けませんでした"
      action={
        <Link href="/mypage" className="flex w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface">
          もう一度試す
        </Link>
      }
    >
      <p>アカウントの権限を確認できませんでした。通信状況を確認して、もう一度お試しください。</p>
    </StatusPanel>
  );
}
