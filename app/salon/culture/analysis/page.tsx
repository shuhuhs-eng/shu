import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { logError } from "@/lib/security/log";
import { AnalysisForm } from "@/components/salon-culture/analysis-form";
import { CultureResultLoadError } from "@/components/salon-culture/culture-result-load-error";
import { saveSalonCultureAnalysis } from "@/lib/salon-culture/analysis/actions";
import {
  ANALYSIS_VERSION,
  extractBaseAnswers,
  extractSupplementAnswers,
  type BaseAnswers,
  type SupplementAnswers,
} from "@/lib/salon-culture/analysis/v1";

/**
 * 本人の「サロンらしさ」追加5問の回答画面（salon-analysis-v1）。
 * 表示時点の既存回答5つを expectedBase としてフォームに持たせ、保存時にサーバーが現在値と照合する。
 */
export default async function SalonCultureAnalysisPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/salon/culture/analysis");
  if (!(await hasCompletedRole(supabase, user.id, "salon"))) redirect("/onboarding/salon");

  const { data: culture, error } = await supabase
    .from("salon_culture_profiles")
    .select("status, answers")
    .eq("salon_user_id", user.id)
    .maybeSingle();
  if (error) {
    logError("salonCultureAnalysisPage", error);
    return <CultureResultLoadError retryHref="/salon/culture/analysis" backHref="/salon/mypage" />;
  }
  const base = culture?.status === "completed" ? extractBaseAnswers(culture.answers) : null;
  if (!base) redirect("/salon/culture");

  const { data: row, error: rowError } = await supabase
    .from("salon_culture_analysis_answers")
    .select("answers")
    .eq("salon_user_id", user.id)
    .eq("analysis_version", ANALYSIS_VERSION)
    .maybeSingle();
  if (rowError) {
    logError("salonCultureAnalysisPage.row", rowError);
    return <CultureResultLoadError retryHref="/salon/culture/analysis" backHref="/salon/mypage" />;
  }
  const initial = row ? extractSupplementAnswers(row.answers) : null;

  const { data: salon } = await supabase.from("salon_profiles").select("salon_name").eq("user_id", user.id).maybeSingle();

  async function save(answers: SupplementAnswers, expectedBase: BaseAnswers) {
    "use server";
    return saveSalonCultureAnalysis({ answers, expectedBase });
  }

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>
      <h1 className="mb-5 font-serif text-xl font-bold text-ink">サロンらしさ 追加の5問</h1>
      <AnalysisForm
        targetName={salon?.salon_name ?? "（サロン名未設定）"}
        targetKind="personal"
        expectedBase={base}
        initial={initial}
        save={save}
        doneHref="/salon/mypage"
        cancelHref="/salon/mypage"
      />
      <div className="mt-8 text-center">
        <Link href="/salon/mypage" className="text-[13px] text-sub underline">
          マイページに戻る
        </Link>
      </div>
    </main>
  );
}
