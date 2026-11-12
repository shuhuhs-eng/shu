import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ProfileVisibility } from "@/types/database";
import type { StoreDetailViewData } from "@/components/stylist-salons/store-detail-view";
import { logError } from "@/lib/security/log";

/**
 * サロン側「美容師からの見え方（プレビュー）」用の読み取り。
 *
 * ★読み取り専用。既存のRLS（salon_stores / salon_store_profiles / salon_store_culture_profiles は
 *   いずれも is_store_accessible() で絞り込み済み）だけに頼り、RLS・公開範囲・RPCは変更しない。
 *   RPC（get_public_salon_store_detail）は「美容師ロール＋公開中」専用なので、サロン側からは呼べない。
 *   代わりに、そのRPCが美容師へ返す項目と同じ列だけを選んで、同じ形のデータに組み立てる
 *   （organization_id・内部ID・store_members・請求・個人情報などは取得しない）。
 * ★取得失敗は「未登録」とは別に error として返す。権限のない店舗・存在しない店舗は区別せず not_found。
 * ★副作用なし（insert/update/delete/rpc を使わない）。
 */
export type StorePreviewResult =
  | {
      status: "ok";
      store: StoreDetailViewData;
      employeeSizeLabel: string | null;
      /** 美容師に実際に公開されている状態か（PUBLIC のときだけ美容師の一覧・詳細に出る）。 */
      visibility: ProfileVisibility;
    }
  | { status: "not_found" } // 権限がない / 存在しない店舗（区別しない）
  | { status: "no_profile"; storeName: string } // 店舗はあるが、プロフィールが未保存
  | { status: "error" };

export async function loadStorePreview(supabase: SupabaseClient<Database>, storeId: string): Promise<StorePreviewResult> {
  const { data: store, error: storeError } = await supabase
    .from("salon_stores")
    .select("id, store_name")
    .eq("id", storeId)
    .maybeSingle();
  if (storeError) {
    // 不正なID形式などの型エラーも含め、権限のない店舗と同じ扱い（存在有無を区別しない）。
    if (storeError.code === "22P02") return { status: "not_found" };
    logError("storePreview.store", storeError);
    return { status: "error" };
  }
  if (!store) return { status: "not_found" };

  const [profileRes, cultureRes] = await Promise.all([
    supabase
      .from("salon_store_profiles")
      .select("visibility, prefecture, city, street_address, culture_description, employee_size_code, target_specialties, bio, hotpepper_url")
      .eq("store_id", storeId)
      .maybeSingle(),
    supabase
      .from("salon_store_culture_profiles")
      .select("id, status, culture_axes, value_priorities, comment, ai_summary")
      .eq("store_id", storeId)
      .maybeSingle(),
  ]);
  if (profileRes.error) {
    logError("storePreview.profile", profileRes.error);
    return { status: "error" };
  }
  if (cultureRes.error) {
    logError("storePreview.culture", cultureRes.error);
    return { status: "error" };
  }
  const profile = profileRes.data;
  if (!profile) return { status: "no_profile", storeName: store.store_name };

  let employeeSizeLabel: string | null = null;
  if (profile.employee_size_code) {
    const { data: sizeRow, error: sizeError } = await supabase
      .from("employee_size_master")
      .select("label")
      .eq("code", profile.employee_size_code)
      .maybeSingle();
    if (sizeError) {
      logError("storePreview.employeeSize", sizeError);
      return { status: "error" };
    }
    employeeSizeLabel = sizeRow?.label ?? null;
  }

  // 美容師向けRPCと同じ規則: 店舗カルチャーは status=completed のときだけ表示する。
  const c = cultureRes.data;
  const culture =
    c && c.status === "completed"
      ? {
          culture_profile_id: c.id,
          culture_axes: c.culture_axes,
          value_priorities: c.value_priorities,
          comment: c.comment,
          ai_summary: c.ai_summary,
        }
      : null;

  return {
    status: "ok",
    visibility: profile.visibility,
    employeeSizeLabel,
    store: {
      store_name: store.store_name,
      prefecture: profile.prefecture,
      city: profile.city,
      street_address: profile.street_address,
      culture_description: profile.culture_description,
      employee_size_code: profile.employee_size_code,
      target_specialties: profile.target_specialties,
      bio: profile.bio,
      hotpepper_url: profile.hotpepper_url,
      culture,
    },
  };
}
