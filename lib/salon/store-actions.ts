"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { salonStoreProfileFormSchema } from "@/lib/validation/salon-store-profile";
import type { AuthActionState } from "@/lib/auth/types";

/**
 * 店舗単位プロフィール保存（法人・複数店舗対応 Phase 3B）。
 * lib/salon/actions.ts の saveSalonProfileAction と対称構造だが、
 * 書き込み先はsave_salon_store_profile() RPC（0030）。
 *
 * ・ 第1引数storeIdはuseActionStateの<form action>にbind()で束縛して渡す
 *   （components/stylist-salons/favorite-salon-button.tsx等と同じ既存パターン）。
 * ・ avatar_path / instagram_handle はsalon_store_profilesに無い列のため
 *   このActionでは扱わない（avatar・写真・外部リンクは引き続きuser_id単位の
 *   既存機能のまま、Phase 3Bの対象外）。
 * ・ RPC側でis_store_accessible(storeId)を確認するため、ここでは所有権の
 *   再チェックを行わない（権限ロジックの複製をしない）。
 */
export async function saveSalonStoreProfileAction(
  storeId: string,
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
    bio: formData.get("bio"),
    visibility: formData.get("visibility"),
    hotpepperUrl: formData.get("hotpepperUrl"),
  };

  const parsed = salonStoreProfileFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: "入力内容をご確認ください。",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const v = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase.rpc("save_salon_store_profile", {
    p_store_id: storeId,
    p_salon_name: v.salonName,
    p_prefecture: v.prefecture,
    p_city: v.city || null,
    p_street_address: v.streetAddress || null,
    p_culture_description: v.cultureDescription || null,
    p_employee_size_code: v.employeeSizeCode || null,
    p_target_specialties: v.targetSpecialties,
    p_bio: v.bio || null,
    p_visibility: v.visibility,
    p_hotpepper_url: v.hotpepperUrl || null,
  });

  if (error) {
    console.error("[saveSalonStoreProfileAction] RPC failed", {
      message: error.message,
      code: error.code,
      storeId,
    });
    return { error: "保存に失敗しました。しばらくしてから再度お試しください。" };
  }

  revalidatePath(`/salon/stores/${storeId}/profile`);
  revalidatePath(`/salon/stores/${storeId}`);

  return { success: "店舗プロフィールを保存しました。" };
}
