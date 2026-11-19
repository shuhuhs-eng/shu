import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SalonStoreCultureWizard } from "@/components/salon-culture/salon-store-culture-wizard";
import { CultureResultLoadError } from "@/components/salon-culture/culture-result-load-error";
import { loadCultureEditState } from "@/lib/salon-culture/load-edit-state";

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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/salon/stores/${storeId}/culture`);

  const st = await loadCultureEditState(supabase, user.id, storeId);
  if (st.loadError) return <CultureResultLoadError retryHref={`/salon/stores/${storeId}/culture`} backHref={`/salon/stores/${storeId}`} />;

  // 閲覧のみの権限では、診断の入力・下書き・確定はできない（DBも拒否する）。
  if (!st.canEdit) {
    return (
      <main className="mx-auto max-w-[560px] px-5 py-12">
        <h1 className="mb-4 font-serif text-xl font-bold text-ink">サロンらしさ</h1>
        <p className="text-[13.5px] leading-relaxed text-charcoal">
          この店舗では閲覧のみの権限のため、診断の入力・保存はできません。回答が必要な場合は、店長・採用担当などの権限をお持ちの方にご依頼ください。
        </p>
        <Link href={`/salon/stores/${storeId}/culture/result`} className="mt-6 inline-flex min-h-[44px] items-center text-[13px] text-sub underline">
          結果を見る
        </Link>
      </main>
    );
  }

  if (st.hasPublished && edit !== "1") {
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
        <SalonStoreCultureWizard
          storeId={storeId}
          initial={st.initial}
          initialRev={st.initialRev}
          hasPublished={st.hasPublished}
          publishedAnswers={st.publishedAnswers}
          publishedExtra={st.publishedExtra}
          publishedExtraBase={st.publishedExtraBase}
          limitStatus={st.limitStatus}
        />
      </div>

      <Link href={`/salon/stores/${storeId}`} className="mt-6 block text-center text-[13px] text-sub underline">
        店舗ワークスペースに戻る（回答は下書きとして保存されています）
      </Link>
    </main>
  );
}
