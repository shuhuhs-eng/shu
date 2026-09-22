import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { SalonProfileFormInitialValues } from "@/components/salon-profile/salon-profile-form";
import { getAvatarSignedUrl } from "@/lib/storage/avatar";
import { getSalonPhotosWithSignedUrls } from "@/lib/salon-photos/actions";
import { getSalonLinks } from "@/lib/salon-links/actions";

/**
 * 3テーブル（profiles / salon_profiles / employee_size_master）から
 * サロンプロフィールフォームの初期値と選択肢を組み立てる。
 * lib/profile/get-initial-values.ts（stylist側）と対称構造。
 *
 * handle_new_user()はsalon_profilesを作成しないため（save_salon_profile()の
 * upsertに一本化）、オンボーディング未完了のユーザーはsalon_profilesに行が
 * 存在しない。.single()ではなく.maybeSingle()を使い、「行が無い」を
 * 正常系（0件=null）として扱う。
 *
 * employee_size_master は enum ではなくマスタテーブル参照のため、
 * stylist側には無い「選択肢を都度DBから取得する」処理が必要になる
 * （これが両者の唯一の構造的な差分＝マスタ参照 vs 固定enum）。
 *
 * @param fallbackSalonName salon_profilesがまだ無い場合のサロン名の初期値
 *   （signup時にサインアップフォームへ入力された表示名。auth.users.user_metadataから
 *   呼び出し元が取得して渡す。DBには保存されていないため、ここでのみ表示に使う）。
 */
export async function getSalonProfileFormInitialValues(
  supabase: SupabaseClient<Database>,
  userId: string,
  fallbackSalonName: string | null = null,
): Promise<{
  initialValues: SalonProfileFormInitialValues;
  employeeSizeOptions: Array<{ code: string; label: string }>;
}> {
  const [{ data: profile }, { data: salon }, { data: employeeSizes }, salonPhotos, salonLinks] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).single(),
    supabase.from("salon_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("employee_size_master").select("*").order("sort_order", { ascending: true }),
    getSalonPhotosWithSignedUrls(),
    getSalonLinks(),
  ]);

  const avatarPath = profile?.avatar_path ?? null;
  const avatarSignedUrl = await getAvatarSignedUrl(supabase, avatarPath);

  const initialValues: SalonProfileFormInitialValues = {
    salonName: salon?.salon_name ?? fallbackSalonName ?? "",
    prefecture: salon?.prefecture ?? "",
    city: salon?.city ?? "",
    streetAddress: salon?.street_address ?? "",
    cultureDescription: salon?.culture_description ?? "",
    employeeSizeCode: salon?.employee_size_code ?? "",
    targetSpecialties: salon?.target_specialties ?? [],
    instagramHandle: salon?.instagram_handle ?? "",
    bio: salon?.bio ?? "",
    avatarPath,
    avatarSignedUrl,
    hotpepperUrl: salon?.hotpepper_url ?? "",
    interiorPhotos: salonPhotos?.interior ?? [],
    atmospherePhotos: salonPhotos?.atmosphere ?? [],
    salonLinks,
    visibility: salon?.visibility ?? "PRIVATE",
  };

  return {
    initialValues,
    employeeSizeOptions: (employeeSizes ?? []).map(
      (e: { code: string; label: string }) => ({ code: e.code, label: e.label }),
    ),
  };
}
