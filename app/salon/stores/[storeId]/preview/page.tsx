import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { loadStorePreview } from "@/lib/store-preview/load";
import { StorePreviewBody } from "@/components/store-preview/preview-body";
import { CultureResultLoadError } from "@/components/salon-culture/culture-result-load-error";

type Props = { params: Promise<{ storeId: string }> };

/**
 * 「美容師からの見え方（プレビュー）」。美容師向け店舗詳細（/stylist/salons/[storeId]）と同じ表示部品で、
 * 保存済みの店舗プロフィールを表示する。
 *
 * ★閲覧専用。応募・お気に入り・「話を聞いてみたい」・相性計算・通知・閲覧記録などは一切呼ばない
 *   （この画面は SELECT のみ。美容師個人の情報も扱わない）。
 * ★アクセス権: ログイン済みのサロン利用者で、既存のRLS（is_store_accessible）で見える店舗だけ。
 *   権限のない店舗・存在しない店舗は区別せず会社ダッシュボードへ戻す（layout と同じ扱い）。
 */
export default async function StorePreviewPage({ params }: Props) {
  const { storeId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/salon/stores/${storeId}/preview`);
  if (!(await hasCompletedRole(supabase, user.id, "salon"))) redirect("/onboarding/salon");

  const result = await loadStorePreview(supabase, storeId);
  if (result.status === "not_found") redirect("/salon/company");
  if (result.status === "error") {
    return <CultureResultLoadError retryHref={`/salon/stores/${storeId}/preview`} backHref="/salon/mypage" />;
  }

  return <StorePreviewBody storeId={storeId} result={result} />;
}
