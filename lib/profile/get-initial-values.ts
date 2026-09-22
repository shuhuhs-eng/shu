import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ProfileFormInitialValues } from "@/components/profile/profile-form";
import { getAvatarSignedUrl } from "@/lib/storage/avatar";

/**
 * 4テーブル（profiles / stylist_private / stylist_profiles / user_settings）から
 * プロフィールフォームの初期値を組み立てる。行が無い列（初回はほぼ全てnull）は
 * フォームの空値・既定値にフォールバックする。
 *
 * handle_new_user()はstylist_private/stylist_profilesを作成しなくなったため
 * （save_stylist_profile()のupsertに一本化）、オンボーディング未完了のユーザーは
 * これらのテーブルに行が存在しない。.single()ではなく.maybeSingle()を使い、
 * 「行が無い」を正常系（0件=null）として扱う。
 *
 * avatarsバケットは非公開のため、profiles.avatar_path（内部パス）をそのまま
 * 画面へ渡すのではなく、ここで署名付きURルを発行してプレビュー表示用に渡す。
 * DBにはパスのみが保存されており、URL自体は保存しない。
 *
 * @param fallbackPublicName stylist_profilesがまだ無い場合の公開名の初期値
 *   （signup時にサインアップフォームへ入力された表示名。auth.users.user_metadataから
 *   呼び出し元が取得して渡す。DBには保存されていないため、ここでのみ表示に使う）。
 */
export async function getProfileFormInitialValues(
  supabase: SupabaseClient<Database>,
  userId: string,
  fallbackPublicName: string | null = null,
): Promise<{ initialValues: ProfileFormInitialValues }> {
  const [{ data: profile }, { data: priv }, { data: pub }, { data: settings }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).single(),
    supabase.from("stylist_private").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("stylist_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("user_settings").select("*").eq("user_id", userId).single(),
  ]);

  const avatarPath = profile?.avatar_path ?? null;
  const avatarSignedUrl = await getAvatarSignedUrl(supabase, avatarPath);

  const initialValues: ProfileFormInitialValues = {
    publicName: pub?.public_name ?? fallbackPublicName ?? "",
    fullName: priv?.full_name ?? "",
    ageBand: priv?.age_band ?? "",
    gender: priv?.gender ?? "",
    prefecture: pub?.prefecture ?? "",
    desiredWorkLocation: pub?.desired_work_location ?? "",
    experienceYears: pub?.experience_years != null ? String(pub.experience_years) : "",
    currentPosition: pub?.current_position ?? "",
    specialties: pub?.specialties ?? [],
    employmentType: pub?.employment_type ?? "",
    jobChangeIntent: pub?.job_change_intent ?? "passive",
    desiredSalaryRange: pub?.desired_salary_range ?? "",
    snsLinks: pub?.sns_links ?? [],
    bio: pub?.bio ?? "",
    avatarPath,
    avatarSignedUrl,
    scoutEnabled: settings?.scout_enabled ?? true,
    visibility: pub?.visibility ?? "PRIVATE",
    valuePriorities: pub?.value_priorities ?? [],
  };

  return { initialValues };
}
