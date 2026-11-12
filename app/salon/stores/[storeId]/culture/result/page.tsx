import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/security/log";
import { CultureResultLoadError } from "@/components/salon-culture/culture-result-load-error";
import { StoreCultureResult } from "@/components/salon-culture/store-culture-result";
import { hasAllTwelveAxes } from "@/lib/salon-culture/salon-culture-types";

type Props = {
  params: Promise<{ storeId: string }>;
};

/**
 * 店舗単位「サロンらしさ」結果画面（法人・複数店舗対応 Phase 3B）。
 * 既存/salon/culture/resultと同じ構造（別ルートとして新設、既存は無変更）。
 */
export default async function SalonStoreCultureResultPage({ params }: Props) {
  const { storeId } = await params;
  const supabase = await createClient();

  const { data: cultureProfile, error: cultureError } = await supabase
    .from("salon_store_culture_profiles")
    .select("*")
    .eq("store_id", storeId)
    .maybeSingle();

  if (cultureError) {
    logError("salonStoreCultureResult", cultureError);
    return (
      <CultureResultLoadError retryHref={`/salon/stores/${storeId}/culture/result`} backHref={`/salon/stores/${storeId}`} />
    );
  }

  if (!cultureProfile || cultureProfile.status !== "completed") {
    redirect(`/salon/stores/${storeId}/culture`);
  }

  const hasNewAxes = hasAllTwelveAxes(cultureProfile.culture_axes ?? {});

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <StoreCultureResult storeId={storeId} profile={cultureProfile} />

      <div className="mt-8 flex flex-col items-center gap-3">
        {hasNewAxes && (
          <Link
            href={`/salon/stores/${storeId}/culture?edit=1`}
            className="flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-4 text-[15px] font-semibold text-ink"
          >
            回答を見直す
          </Link>
        )}
        <Link href={`/salon/stores/${storeId}`} className="text-[13px] text-sub underline">
          店舗ワークスペースに戻る
        </Link>
      </div>
    </main>
  );
}
