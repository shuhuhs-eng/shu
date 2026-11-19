import type { SalonStoreProfileFormValues } from "@/lib/validation/salon-store-profile";

/**
 * 店舗プロフィールの保存（save_salon_store_profile_v2 RPC（0088）の呼び出し。文化欄（culture_description）は送らない・書かない）。DB 呼び出しを注入できる形にして、テストで確認する。
 * ・公開範囲は、フォームの値をそのまま RPC の p_visibility へ渡す（ここで書き換えない）。
 * ・成功と表示してよいのは、RPC がエラー無しで、保存された行の store_id と visibility が送った値と一致したときだけ。
 */
export type StoreProfileSaveDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string | null } | null }>;
  log: (where: string, error: unknown) => void;
};

export const STORE_PROFILE_SAVE_FAILED = "保存に失敗しました。しばらくしてから再度お試しください。";
/** 競合・保護の専用メッセージ（入力内容は画面に残る）。DBのエラー内容そのものは画面に出さない。 */
export const STORE_PROFILE_TEXT_STALE = "他の画面で店舗紹介が更新されました。最新の内容を読み込み直してから、もう一度編集してください（今の入力内容は画面に残っています。必要なら先にコピーしてください）。";
export const STORE_PROFILE_DISPLAY_STALE = "他の画面で表示の設定が更新されました。画面を読み込み直して、最新の状態を確認してください。";
export const STORE_PROFILE_SAVE_UNCONFIRMED = "保存の結果を確認できませんでした。画面を更新して、内容が保存されているかご確認ください。";

export async function saveStoreProfile(
  deps: StoreProfileSaveDeps,
  storeId: string,
  v: SalonStoreProfileFormValues,
): Promise<{ success: true } | { success: false; error: string }> {
  const { data, error } = await deps.rpc("save_salon_store_profile_v2", {
    p_store_id: storeId,
    p_salon_name: v.salonName,
    p_prefecture: v.prefecture,
    p_city: v.city || null,
    p_street_address: v.streetAddress || null,
    p_employee_size_code: v.employeeSizeCode || null,
    p_target_specialties: v.targetSpecialties,
    p_bio: v.bio || null,
    p_visibility: v.visibility,
    p_hotpepper_url: v.hotpepperUrl || null,
    p_expected_revision: v.expectedRevision ?? null,
    p_intro_display: v.introDisplay ?? "keep",
  });
  if (error) {
    deps.log("saveSalonStoreProfileAction", error);
    if (/profile_text_stale/.test(error.message)) return { success: false, error: STORE_PROFILE_TEXT_STALE };
    if (/profile_display_stale/.test(error.message)) return { success: false, error: STORE_PROFILE_DISPLAY_STALE };
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
