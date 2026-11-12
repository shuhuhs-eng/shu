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

  const { data: store, error: storeError } = await supabase
    .from("salon_stores")
    .select("store_name")
    .eq("id", storeId)
    .maybeSingle();
  if (storeError) logError("salonStoreProfilePage.store", storeError);

  const loaded = await getSalonStoreProfileFormInitialValues(supabase, storeId, store?.store_name ?? null);
  const { employeeSizeOptions, exists, loadError } = loaded;
  // 未作成の店舗は、店舗名をサロン名の初期値にする。公開範囲は「非公開」から始める。
  const initialValues = loaded.initialValues;
  // 取得に失敗したときは、空のフォームを出さない（保存すると既存の内容を上書きしてしまうため）。
  const blocked = loadError || storeError;

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <h1 className="font-serif text-2xl font-bold text-ink">
        {exists || blocked ? "店舗プロフィール編集" : "店舗プロフィールを作成"}
      </h1>
      {store?.store_name && (
        <p className="mt-2 text-[13px] font-semibold text-ink">対象店舗：{store.store_name}</p>
      )}
      {blocked ? (
        <p className="mt-6 rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] leading-relaxed text-ink">
          店舗の情報を読み込めませんでした。内容を上書きしないよう、編集画面は表示していません。画面を更新してもう一度お試しください。
        </p>
      ) : (
        <>
          {exists ? (
            <p className="mt-3 text-[14px] leading-relaxed text-charcoal">登録内容はいつでも変更できます。</p>
          ) : (
            <p className="mt-3 rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] leading-relaxed text-ink">
              この店舗の公開用プロフィールは、まだ作成されていません。保存すると作成され、選んだ公開範囲で美容師に表示されます。公開範囲は「非公開」から始まります。
            </p>
          )}
          {exists && (
            <p className="mt-2 text-[12.5px] leading-relaxed text-sub">
              保存したあと、
              <Link href={`/salon/stores/${storeId}/preview`} className="font-semibold underline">
                美容師からの見え方（プレビュー）
              </Link>
              で確認できます。
            </p>
          )}

          <div className="mt-6">
            <SalonStoreProfileForm
              storeId={storeId}
              initialValues={initialValues}
              employeeSizeOptions={employeeSizeOptions}
            />
          </div>
        </>
      )}
    </main>
  );
}
