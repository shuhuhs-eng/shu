import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { SalonStoreAssetsInitialValues } from "@/components/salon-profile/salon-store-assets";
import { getAvatarSignedUrl } from "@/lib/storage/avatar";
import { getSalonPhotosWithSignedUrls } from "@/lib/salon-photos/actions";
import { getSalonLinks } from "@/lib/salon-links/actions";

/**
 * 店舗プロフィール編集画面に統合した「ロゴ・写真・リンク」の初期値（既存の取得処理を使う）。
 * 取得に失敗したときは loadError=true を返し、呼び出し側は編集欄を出さない
 * （空の初期値のままロゴを保存して、登録済みのロゴを消してしまわないため）。
 */
export async function getSalonStoreAssetsInitialValues(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ initialValues: SalonStoreAssetsInitialValues; loadError: boolean }> {
  const [{ data: profile, error: profileError }, salonPhotos, salonLinks] = await Promise.all([
    supabase.from("profiles").select("avatar_path").eq("id", userId).single(),
    getSalonPhotosWithSignedUrls(),
    getSalonLinks(),
  ]);
  const avatarPath = profile?.avatar_path ?? null;
  const avatarSignedUrl = await getAvatarSignedUrl(supabase, avatarPath);
  return {
    loadError: Boolean(profileError) || salonPhotos === null,
    initialValues: {
      avatarPath,
      avatarSignedUrl,
      interiorPhotos: salonPhotos?.interior ?? [],
      atmospherePhotos: salonPhotos?.atmosphere ?? [],
      salonLinks,
    },
  };
}
