import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { AnalysisForm } from "@/components/salon-culture/analysis-form";
import { CultureResultLoadError } from "@/components/salon-culture/culture-result-load-error";
import { saveExtraAndConfirmAction } from "@/lib/salon-culture/draft-actions";
import { loadCultureEditState } from "@/lib/salon-culture/load-edit-state";
import { answersSameAsPublished } from "@/lib/salon-culture/draft";
import { extraNotice } from "@/lib/diagnosis-limit/messages";
import {
  changedBaseKeys,
  extractBaseAnswers,
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

  const st = await loadCultureEditState(supabase, user.id, null);
  if (st.loadError) return <CultureResultLoadError retryHref="/salon/culture/analysis" backHref="/salon/mypage" />;
  // 12問の出発点は、下書きがあれば下書き、なければ公開中の結果。12問が確定していなければ先に12問へ。
  const base = st.hasPublished ? extractBaseAnswers(st.initial.answers) : null;
  if (!base) redirect("/salon/culture");
  const initial = st.initial.extra;
  // 追加回答を答えたときの基本5問から、いまの基本5問が変わっているなら、直さずに保存するときは確認が必要。
  const requireAck = st.publishedExtra != null && changedBaseKeys(st.publishedExtraBase, base).length > 0;
  const notices = extraNotice(st.limitStatus, {
    hadExtra: st.publishedExtra != null,
    pendingTwelveChange: st.hasDraft && !answersSameAsPublished(st.initial.answers, st.publishedAnswers),
  });

  const { data: salon } = await supabase.from("salon_profiles").select("salon_name").eq("user_id", user.id).maybeSingle();

  async function save(answers: SupplementAnswers, expectedBase: BaseAnswers, requestId: string, acknowledged: boolean) {
    "use server";
    return saveExtraAndConfirmAction(null, answers, expectedBase, requestId, acknowledged);
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
        requireAck={requireAck}
        notices={notices}
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
