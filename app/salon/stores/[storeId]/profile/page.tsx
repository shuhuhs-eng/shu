import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/security/log";
import { getSalonStoreProfileFormInitialValues } from "@/lib/salon/store-get-initial-values";
import { SalonStoreProfileForm } from "@/components/salon-profile/salon-store-profile-form";

type Props = {
  params: Promise<{ storeId: string }>;
};

/**
 * 店舗単位プロフィール編集画面（法人・複数店舗対応 Phase 3B）。
 *
 * ★アクセス制御は親layout.tsx（/salon/stores/[storeId]/layout.tsx、既存
 * Phase 2実装）がis_store_accessible()で既に行っているため、このページ
 * 自体では追加の権限チェックを行わない（layout.tsxを通過した時点で
 * このstoreIdへのアクセスは許可済み）。
 *
 * ★既存/salon/profileは一切変更していない（別ルート・別フォーム）。
 */
export default async function SalonStoreProfilePage({ params }: Props) {
  const { storeId } = await params;
  const supabase = await createClient();

  const { initialValues, employeeSizeOptions } = await getSalonStoreProfileFormInitialValues(
    supabase,
    storeId,
  );

  // 編集の対象店舗を明示する（取得できなくても編集自体は続けられる。失敗はログに残す）。
  const { data: store, error: storeError } = await supabase
    .from("salon_stores")
    .select("store_name")
    .eq("id", storeId)
    .maybeSingle();
  if (storeError) logError("salonStoreProfilePage.store", storeError);

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <h1 className="font-serif text-2xl font-bold text-ink">店舗プロフィール編集</h1>
      {store?.store_name && (
        <p className="mt-2 text-[13px] font-semibold text-ink">対象店舗：{store.store_name}</p>
      )}
      <p className="mt-3 text-[14px] leading-relaxed text-charcoal">
        登録内容はいつでも変更できます。
      </p>
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">
        保存したあと、
        <Link href={`/salon/stores/${storeId}/preview`} className="font-semibold underline">
          美容師からの見え方（プレビュー）
        </Link>
        で確認できます。
      </p>

      <div className="mt-6">
        <SalonStoreProfileForm
          storeId={storeId}
          initialValues={initialValues}
          employeeSizeOptions={employeeSizeOptions}
        />
      </div>
    </main>
  );
}
