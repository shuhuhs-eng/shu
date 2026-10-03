import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { SalonStoreProfileFormInitialValues } from "@/components/salon-profile/salon-store-profile-form";

/**
 * 店舗単位プロフィールフォームの初期値（法人・複数店舗対応 Phase 3B）。
 * lib/salon/get-initial-values.ts（旧・user_id単位）と対称構造だが、
 * salon_store_profilesをstore_idで取得する点のみが異なる。
 *
 * avatar・サロン写真・外部リンクはuser_id単位の既存機能のままのため、
 * ここでは取得しない（salon_store_profilesに対応する列が無いため）。
 *
 * 店舗がまだ一度もプロフィールを保存していない場合（salon_store_profilesに
 * 行が無い）は、.maybeSingle()により「行が無い」を正常系（0件=null）として
 * 扱う（save_salon_store_profile()のupsertに一本化する既存同様の設計）。
 */
export async function getSalonStoreProfileFormInitialValues(
  supabase: SupabaseClient<Database>,
  storeId: string,
  fallbackSalonName: string | null = null,
): Promise<{
  initialValues: SalonStoreProfileFormInitialValues;
  employeeSizeOptions: Array<{ code: string; label: string }>;
}> {
  const [{ data: storeProfile }, { data: employeeSizes }] = await Promise.all([
    supabase.from("salon_store_profiles").select("*").eq("store_id", storeId).maybeSingle(),
    supabase.from("employee_size_master").select("*").order("sort_order", { ascending: true }),
  ]);

  const initialValues: SalonStoreProfileFormInitialValues = {
    salonName: storeProfile?.salon_name ?? fallbackSalonName ?? "",
    prefecture: storeProfile?.prefecture ?? "",
    city: storeProfile?.city ?? "",
    streetAddress: storeProfile?.street_address ?? "",
    cultureDescription: storeProfile?.culture_description ?? "",
    employeeSizeCode: storeProfile?.employee_size_code ?? "",
    targetSpecialties: storeProfile?.target_specialties ?? [],
    bio: storeProfile?.bio ?? "",
    hotpepperUrl: storeProfile?.hotpepper_url ?? "",
    visibility: storeProfile?.visibility ?? "PRIVATE",
  };

  return {
    initialValues,
    employeeSizeOptions: (employeeSizes ?? []).map(
      (e: { code: string; label: string }) => ({ code: e.code, label: e.label }),
    ),
  };
}
