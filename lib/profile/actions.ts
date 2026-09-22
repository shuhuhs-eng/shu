"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { profileFormSchema } from "@/lib/validation/profile";
import { SNS_PLATFORMS } from "@/lib/validation/profile-options";
import type { AuthActionState } from "@/lib/auth/types";
import type { SnsLink } from "@/types/database";

/**
 * プロフィール保存。onboarding画面（初回）・編集画面（以降）の両方から呼ばれる共通アクション。
 *
 * 4テーブル（stylist_private / stylist_profiles / user_settings / profiles）への
 * 書き込みと onboarding_step・profile_version の更新は、すべて save_stylist_profile()
 * RPC 1回の呼び出しにまとめている。RPC はサーバー側で単一トランザクションとして
 * 実行され、途中で失敗した場合は全ての変更がロールバックされる（Server Action側で
 * 個別にテーブルを更新する処理は行わない）。
 *
 * avatar_path の扱い（固定パス方式）:
 *   ・保存パスはユーザーごとに "{userId}/avatar.webp" 固定で、アップロードは
 *     常に upsert:true で同じオブジェクトを置き換える（AvatarUploader側）。
 *     そのため通常時、送信される avatarPath は既存の値と常に同じ文字列になる。
 *   ・RPC自体はStorageの削除を一切行わない（RPC内では検証のみ）。
 *   ・旧画像の削除は、RPCの成功を確認した「後」にのみ、このServer Action側で行う
 *     （現在の avatar_path と今回の送信値が異なる場合のみ削除対象。固定パス方式では
 *     基本的に「以前アバターが無かった状態から新規に設定した」場合以外は
 *     パスが変わらないため削除対象にならないが、将来アバター削除機能を追加した際
 *     （送信値が null になるケース）にも正しく動作するよう、この判定にしている）。
 *   ・RPCが失敗した場合は何も削除しない。アップロード自体は固定パスへの upsert
 *     であり、失敗時に削除すると「保存に失敗しただけなのに、既存の正常な
 *     アバターまで消えてしまう」ことになるため、失敗時の削除は行わない。
 *
 * ★開発ルール: save_salon_profile / saveSalonProfileAction（lib/salon/actions.ts）
 *   を変更した場合は、save_stylist_profile / saveProfileAction にも同じ変更が
 *   必要かを必ず確認すること（逆方向も同様）。両者は保存先テーブル以外は対称構造を
 *   維持する方針（supabase/migrations/0001_init.sql のRPC直前のコメントも参照）。
 */
export async function saveProfileAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  // SNSはプラットフォームごとに個別のフィールド(sns_instagram等)として送られてくるため、
  // 空でないものだけをsnsLinks配列へ組み立てる（SNS_PLATFORMSを増やしてもこの処理は
  // そのまま対応できる＝拡張可能設計）。
  const snsLinks: SnsLink[] = SNS_PLATFORMS.map((p) => ({
    platform: p.code,
    handle: String(formData.get(`sns_${p.code}`) ?? "").trim(),
  })).filter((link) => link.handle !== "");

  const raw = {
    publicName: formData.get("publicName"),
    prefecture: formData.get("prefecture"),
    desiredWorkLocation: formData.get("desiredWorkLocation"),
    experienceYears: formData.get("experienceYears"),
    currentPosition: formData.get("currentPosition"),
    specialties: formData.getAll("specialties"),
    employmentType: formData.get("employmentType"),
    jobChangeIntent: formData.get("jobChangeIntent"),
    desiredSalaryRange: formData.get("desiredSalaryRange"),
    snsLinks,
    bio: formData.get("bio"),
    avatarPath: formData.get("avatarPath"),
    fullName: formData.get("fullName"),
    ageBand: formData.get("ageBand"),
    gender: formData.get("gender"),
    valuePriorities: formData.getAll("valuePriorities"),
    scoutEnabled: formData.get("scoutEnabled"),
    visibility: formData.get("visibility"),
  };

  const parsed = profileFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: "入力内容をご確認ください。",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const v = parsed.data;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "セッションが切れています。再度ログインしてください。" };
  }

  const newAvatarPath = v.avatarPath || null;

  // 旧画像削除の判定に使うため、RPC呼び出し前の現在の avatar_path を取得しておく。
  const { data: beforeProfile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  const previousAvatarPath = beforeProfile?.avatar_path ?? null;

  const { error } = await supabase.rpc("save_stylist_profile", {
    p_public_name: v.publicName,
    p_full_name: v.fullName,
    p_age_band: v.ageBand,
    p_gender: v.gender,
    p_prefecture: v.prefecture,
    p_desired_work_location: v.desiredWorkLocation || null,
    p_experience_years: v.experienceYears,
    p_current_position: v.currentPosition || null,
    p_specialties: v.specialties,
    p_employment_type: v.employmentType,
    p_job_change_intent: v.jobChangeIntent,
    p_desired_salary_range: v.desiredSalaryRange,
    p_sns_links: v.snsLinks,
    p_bio: v.bio || null,
    p_visibility: v.visibility,
    p_scout_enabled: v.scoutEnabled === "true",
    p_avatar_path: newAvatarPath,
    p_value_priorities: v.valuePriorities,
  });

  if (error) {
    // 固定パス方式のため、失敗時にStorage側を削除する補償処理は行わない
    // （削除すると既存の正常なアバターを消してしまう可能性があるため）。
    return { error: "保存に失敗しました。しばらくしてから再度お試しください。" };
  }

  // 保存成功後にのみ、不要になった旧画像を削除する。
  if (previousAvatarPath && previousAvatarPath !== newAvatarPath) {
    await supabase.storage.from("avatars").remove([previousAvatarPath]);
  }

  revalidatePath("/onboarding");
  revalidatePath("/profile/edit");
  revalidatePath("/stylist/profile");
  revalidatePath("/stylist/mypage");
  revalidatePath("/");

  return { success: "プロフィールを保存しました。" };
}
