import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/security/log";
import { getSalonStoreProfileFormInitialValues } from "@/lib/salon/store-get-initial-values";
import { SalonStoreProfileForm } from "@/components/salon-profile/salon-store-profile-form";
import { SalonStoreAssets } from "@/components/salon-profile/salon-store-assets";
import { getSalonStoreAssetsInitialValues } from "@/lib/salon/assets-initial-values";
import { loadStoreAssets } from "@/lib/store-assets/load";
import { StoreAssetsEditor } from "@/components/store-assets/store-assets-editor";
import { StoreAssetsSection } from "@/components/store-assets/store-assets-section";
import { canManageStoreHiringHint } from "@/lib/hiring/permissions";

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
 * ★ロゴ・写真・外部リンクもこの画面で編集する（旧 /salon/profile の中身をそのまま移した。
 *   保存先はこれまでと同じアカウント単位で、データの移行は無い）。旧 /salon/profile は
 *   店舗がある場合、この画面へ案内する。
 */
export default async function SalonStoreProfilePage({ params }: Props) {
  const { storeId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: store, error: storeError } = await supabase
    .from("salon_stores")
    .select("store_name, organization_id")
    .eq("id", storeId)
    .maybeSingle();
  if (storeError) logError("salonStoreProfilePage.store", storeError);

  const loaded = await getSalonStoreProfileFormInitialValues(supabase, storeId, store?.store_name ?? null);
  const { employeeSizeOptions, exists, loadError } = loaded;
  // 未作成の店舗は、店舗名をサロン名の初期値にする。公開範囲は「公開」から始める（保存済みの店舗は保存済みの値）。
  const initialValues = loaded.initialValues;
  // 取得に失敗したときは、空のフォームを出さない（保存すると既存の内容を上書きしてしまうため）。
  const blocked = loadError || storeError;
  // 閲覧のみの担当者は、プロフィール・ロゴ・写真・リンクの保存・アップロード・削除ができない（表示上のヒント。最終防衛はDB）。
  const canManage =
    !!user && !!store && (await canManageStoreHiringHint(supabase, user.id, storeId, store.organization_id));
  // ロゴ・写真・リンクは、店舗別（0081）が使えるときは店舗別を、未適用のときは従来のアカウント共通を使う。
  const storeAssets = !blocked ? await loadStoreAssets(supabase, storeId, "staff") : null;
  const legacyAssets =
    user && !blocked && canManage && storeAssets?.status === "unavailable"
      ? await getSalonStoreAssetsInitialValues(supabase, user.id)
      : null;

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
              この店舗の公開用プロフィールは、まだ作成されていません。保存すると作成され、選んだ公開範囲で美容師に表示されます。公開範囲は「公開」から始まります（非公開にもできます）。
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

          {canManage ? (
            <div className="mt-6">
              <SalonStoreProfileForm
                key={storeId}
                storeId={storeId}
                initialValues={initialValues}
                employeeSizeOptions={employeeSizeOptions}
              />
            </div>
          ) : (
            <p className="mt-6 rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] leading-relaxed text-ink">
              この店舗では閲覧のみの権限のため、店舗プロフィールの保存はできません。変更が必要な場合は、店長・採用担当・管理者にご依頼ください。現在の内容は「プレビュー」で確認できます。
            </p>
          )}

          <div className="mt-10 border-t border-line pt-8">
            <h2 className="font-serif text-xl font-bold text-ink">ロゴ・写真・リンク</h2>
            {storeAssets?.status === "ok" ? (
              canManage ? (
                <div className="mt-5">
                  <StoreAssetsEditor key={storeId} storeId={storeId} storeName={store?.store_name ?? "この店舗"} initial={storeAssets.assets} />
                </div>
              ) : (
                <div className="mt-2">
                  <p className="text-[12.5px] leading-relaxed text-sub">閲覧のみの権限のため、ロゴ・写真・リンクの追加・差し替え・削除はできません。</p>
                  <StoreAssetsSection assets={storeAssets.assets} />
                </div>
              )
            ) : storeAssets?.status === "unavailable" ? (
              canManage && legacyAssets && !legacyAssets.loadError && user ? (
                <div className="mt-5">
                  <SalonStoreAssets key={storeId} userId={user.id} initialValues={legacyAssets.initialValues} />
                </div>
              ) : canManage ? (
                <p className="mt-4 rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] leading-relaxed text-ink">
                  ロゴ・写真・リンクを読み込めませんでした。登録済みの内容を上書きしないよう、この欄は表示していません。画面を更新してもう一度お試しください。
                </p>
              ) : (
                <p className="mt-4 text-[12.5px] leading-relaxed text-sub">閲覧のみの権限のため、ロゴ・写真・リンクの編集はできません。</p>
              )
            ) : (
              <p className="mt-4 rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] leading-relaxed text-ink">
                ロゴ・写真・リンクを読み込めませんでした。登録済みの内容を上書きしないよう、この欄は表示していません。画面を更新してもう一度お試しください。
              </p>
            )}
          </div>
        </>
      )}
    </main>
  );
}
