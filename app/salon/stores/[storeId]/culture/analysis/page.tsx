import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/security/log";
import { AnalysisForm } from "@/components/salon-culture/analysis-form";
import { CultureResultLoadError } from "@/components/salon-culture/culture-result-load-error";
import { saveSalonStoreCultureAnalysis } from "@/lib/salon-culture/analysis/actions";
import {
  ANALYSIS_VERSION,
  extractBaseAnswers,
  extractSupplementAnswers,
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

  const { data: culture, error } = await supabase
    .from("salon_store_culture_profiles")
    .select("status, answers")
    .eq("store_id", storeId)
    .maybeSingle();
  if (error) {
    logError("salonStoreCultureAnalysisPage", error);
    return <CultureResultLoadError retryHref={`/salon/stores/${storeId}/culture/analysis`} backHref={backHref} />;
  }
  const base = culture?.status === "completed" ? extractBaseAnswers(culture.answers) : null;
  if (!base) redirect(`/salon/stores/${storeId}/culture`);

  const { data: row, error: rowError } = await supabase
    .from("salon_culture_analysis_answers")
    .select("answers")
    .eq("store_id", storeId)
    .eq("analysis_version", ANALYSIS_VERSION)
    .maybeSingle();
  if (rowError) {
    logError("salonStoreCultureAnalysisPage.row", rowError);
    return <CultureResultLoadError retryHref={`/salon/stores/${storeId}/culture/analysis`} backHref={backHref} />;
  }
  const initial = row ? extractSupplementAnswers(row.answers) : null;

  const { data: store } = await supabase.from("salon_stores").select("store_name").eq("id", storeId).maybeSingle();

  async function save(answers: SupplementAnswers, expectedBase: BaseAnswers) {
    "use server";
    return saveSalonStoreCultureAnalysis({ storeId, answers, expectedBase });
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
        doneHref={resultHref}
        cancelHref={resultHref}
      />
    </main>
  );
}
