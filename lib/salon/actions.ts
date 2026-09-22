"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { salonProfileFormSchema } from "@/lib/validation/salon-profile";
import type { AuthActionState } from "@/lib/auth/types";

/**
 * サロンプロフィール保存。lib/profile/actions.ts の saveProfileAction と対称構造。
 *
 * ・ salon_profiles / profiles(avatar_path, onboarding_step, profile_version) への
 *   書き込みは save_salon_profile() RPC 1回の呼び出しにまとめている。RPC は
 *   サーバー側で単一トランザクションとして実行され、途中で失敗した場合は
 *   全ての変更がロールバックされる（Server Action側で個別にテーブルを
 *   更新する処理は行わない）。
 * ・avatar_path の扱い（固定パス方式・旧画像削除のタイミング）は
 *   saveProfileAction と完全に同一のロジック（stylist/salonともに
 *   同じavatarsバケット・同じ"{userId}/avatar.webp"固定パスを使う）。
 *
 * ★開発ルール: save_stylist_profile / saveProfileAction を変更した場合は、
 *   save_salon_profile / saveSalonProfileAction にも同じ変更が必要かを
 *   必ず確認すること（逆方向も同様）。両者は保存先テーブル以外は対称構造を
 *   維持する方針（supabase/migrations/0001_init.sql のRPCコメントも参照）。
 */
export async function saveSalonProfileAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const raw = {
    salonName: formData.get("salonName"),
    prefecture: formData.get("prefecture"),
    city: formData.get("city"),
    streetAddress: formData.get("streetAddress"),
    cultureDescription: formData.get("cultureDescription"),
    employeeSizeCode: formData.get("employeeSizeCode"),
    targetSpecialties: formData.getAll("targetSpecialties"),
    instagramHandle: formData.get("instagramHandle"),
    bio: formData.get("bio"),
    avatarPath: formData.get("avatarPath"),
    visibility: formData.get("visibility"),
    hotpepperUrl: formData.get("hotpepperUrl"),
  };

  const parsed = salonProfileFormSchema.safeParse(raw);
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

  const { error } = await supabase.rpc("save_salon_profile", {
    p_salon_name: v.salonName,
    p_prefecture: v.prefecture,
    p_city: v.city || null,
    p_street_address: v.streetAddress || null,
    p_culture_description: v.cultureDescription || null,
    p_employee_size_code: v.employeeSizeCode || null,
    p_target_specialties: v.targetSpecialties,
    p_instagram_handle: v.instagramHandle || null,
    p_bio: v.bio || null,
    p_visibility: v.visibility,
    p_avatar_path: newAvatarPath,
    p_hotpepper_url: v.hotpepperUrl || null,
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

  revalidatePath("/onboarding/salon");
  revalidatePath("/profile/edit/salon");
  revalidatePath("/salon/profile");
  revalidatePath("/salon/mypage");
  revalidatePath("/");

  return { success: "プロフィールを保存しました。" };
}
