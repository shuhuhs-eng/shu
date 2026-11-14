import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/security/log";
import { AnalysisForm } from "@/components/salon-culture/analysis-form";
import { CultureResultLoadError } from "@/components/salon-culture/culture-result-load-error";
import { saveExtraAndConfirmAction } from "@/lib/salon-culture/draft-actions";
import { loadCultureEditState } from "@/lib/salon-culture/load-edit-state";
import { answersSameAsPublished } from "@/lib/salon-culture/draft";
import { extraNotice } from "@/lib/diagnosis-limit/messages";
import {
  extractBaseAnswers,
  type BaseAnswers,
  type SupplementAnswers,
} from "@/lib/salon-culture/analysis/v1";

type Props = { params: Promise<{ storeId: string }> };

/**
 * 店舗の「サロンらしさ」追加5問の回答画面。個人の回答とは別（自動同期なし）。
 * アクセス権は [storeId]/layout（is_store_accessible）で確認済み。
 * 保存できるのは can_edit_store_culture_analysis が true の人だけ（閲覧のみには表示しない）。
 */
export default async function SalonStoreCultureAnalysisPage({ params }: Props) {
  const { storeId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/salon/stores/${storeId}/culture/analysis`);
  const backHref = `/salon/stores/${storeId}`;
  const resultHref = `/salon/stores/${storeId}/culture/result`;

  const { data: canEdit, error: canEditError } = await supabase.rpc("can_edit_store_culture_analysis", { p_store_id: storeId });
  if (canEditError) {
    logError("salonStoreCultureAnalysisPage.canEdit", canEditError);
    return <CultureResultLoadError retryHref={`/salon/stores/${storeId}/culture/analysis`} backHref={backHref} />;
  }
  if (canEdit !== true) {
    return (
      <main className="mx-auto max-w-[560px] px-5 py-12">
        <h1 className="mb-4 font-serif text-xl font-bold text-ink">サロンらしさ 追加の5問</h1>
        <p className="text-[13.5px] leading-relaxed text-charcoal">
          この店舗では閲覧のみの権限のため、追加の回答はできません。回答が必要な場合は、店長・採用担当などの権限をお持ちの方にご依頼ください。
        </p>
        <Link href={resultHref} className="mt-6 inline-block text-[13px] text-sub underline">
          結果に戻る
        </Link>
      </main>
    );
  }

  const st = await loadCultureEditState(supabase, user.id, storeId);
  if (st.loadError) return <CultureResultLoadError retryHref={`/salon/stores/${storeId}/culture/analysis`} backHref={backHref} />;
  const base = st.hasPublished ? extractBaseAnswers(st.initial.answers) : null;
  if (!base) redirect(`/salon/stores/${storeId}/culture`);
  const initial = st.initial.extra;
  const notices = extraNotice(st.limitStatus, {
    hadExtra: st.publishedExtra != null,
    pendingTwelveChange: st.hasDraft && !answersSameAsPublished(st.initial.answers, st.publishedAnswers),
  });

  const { data: store } = await supabase.from("salon_stores").select("store_name").eq("id", storeId).maybeSingle();

  async function save(answers: SupplementAnswers, expectedBase: BaseAnswers, requestId: string) {
    "use server";
    return saveExtraAndConfirmAction(storeId, answers, expectedBase, requestId);
  }

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>
      <h1 className="mb-5 font-serif text-xl font-bold text-ink">サロンらしさ 追加の5問</h1>
      <AnalysisForm
        targetName={store?.store_name ?? "（店舗名未設定）"}
        targetKind="store"
        expectedBase={base}
        initial={initial}
        save={save}
        notices={notices}
        doneHref={resultHref}
        cancelHref={resultHref}
      />
    </main>
  );
}
