import type { SalonStoreProfileFormValues } from "@/lib/validation/salon-store-profile";

/**
 * 店舗プロフィールの保存（save_salon_store_profile RPC の呼び出し）。DB 呼び出しを注入できる形にして、テストで確認する。
 * ・公開範囲は、フォームの値をそのまま RPC の p_visibility へ渡す（ここで書き換えない）。
 * ・成功と表示してよいのは、RPC がエラー無しで、保存された行の store_id と visibility が送った値と一致したときだけ。
 */
export type StoreProfileSaveDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string | null } | null }>;
  log: (where: string, error: unknown) => void;
};

export const STORE_PROFILE_SAVE_FAILED = "保存に失敗しました。しばらくしてから再度お試しください。";
export const STORE_PROFILE_SAVE_UNCONFIRMED = "保存の結果を確認できませんでした。画面を更新して、内容が保存されているかご確認ください。";

export async function saveStoreProfile(
  deps: StoreProfileSaveDeps,
  storeId: string,
  v: SalonStoreProfileFormValues,
): Promise<{ success: true } | { success: false; error: string }> {
  const { data, error } = await deps.rpc("save_salon_store_profile", {
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
    deps.log("saveSalonStoreProfileAction", error);
    return { success: false, error: STORE_PROFILE_SAVE_FAILED };
  }
  // RPC は保存した行を返す（単一の行。念のため1件の配列も受け付ける）。
  const row = (Array.isArray(data) ? data[0] : data) as { store_id?: string; visibility?: string } | null | undefined;
  if (!row || row.store_id !== storeId || row.visibility !== v.visibility) {
    deps.log("saveSalonStoreProfileAction.unconfirmed", new Error("saved row does not match the request"));
    return { success: false, error: STORE_PROFILE_SAVE_UNCONFIRMED };
  }
  return { success: true };
}
