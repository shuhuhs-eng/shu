import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SalonStoreCultureWizard } from "@/components/salon-culture/salon-store-culture-wizard";

type Props = {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ edit?: string }>;
};

/**
 * 店舗単位「サロンらしさ」入力画面（法人・複数店舗対応 Phase 3B）。
 *
 * ★アクセス制御は親layout.tsx（is_store_accessible()）が既に行っている
 * ため、ここでは追加の権限チェックを行わない。
 * ★既存/salon/cultureは一切変更していない（別ルート）。
 */
export default async function SalonStoreCulturePage({ params, searchParams }: Props) {
  const { storeId } = await params;
  const { edit } = await searchParams;
  const supabase = await createClient();

  const { data: cultureProfile } = await supabase
    .from("salon_store_culture_profiles")
    .select("*")
    .eq("store_id", storeId)
    .maybeSingle();

  if (cultureProfile?.status === "completed" && edit !== "1") {
    redirect(`/salon/stores/${storeId}/culture/result`);
  }

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <h1 className="font-serif text-2xl font-bold text-ink">サロンらしさを教えてください</h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-charcoal">
        求人票では伝わらない、この店舗の雰囲気や価値観を伝える質問です。今、実際にどうしているかをお答えください。
      </p>

      <div className="mt-7">
        <SalonStoreCultureWizard storeId={storeId} initialProfile={cultureProfile ?? null} />
      </div>

      <Link href={`/salon/stores/${storeId}`} className="mt-6 block text-center text-[13px] text-sub underline">
        店舗ワークスペースに戻る（回答内容は保存されています）
      </Link>
    </main>
  );
}
