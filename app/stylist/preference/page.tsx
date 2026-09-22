import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { StylistPreferenceWizard } from "@/components/stylist-preference/preference-wizard";

/**
 * 美容師「働きたいサロン環境」Preference診断の入力・編集ページ。
 * /stylist/preference（新規） / /stylist/preference?edit=1（再回答）の両方を
 * このページが受け持つ（サロンらしさの/salon/cultureと同じパターン）。
 *
 * ★role guard: middleware（STYLIST_ONLY_PREFIXESに/stylist/preferenceを
 * 追加済み）に加えて、このページ自体でもstylist roleの完了を確認する
 * 多重防御（既存の/stylist/mypage・/stylist/diagnosisと同じパターン）。
 * salon roleユーザーはここへ到達しない。
 */
export default async function StylistPreferencePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/stylist/preference");
  }

  if (!(await hasCompletedRole(supabase, user.id, "stylist"))) {
    redirect("/onboarding");
  }

  const { data: profile } = await supabase
    .from("stylist_preference_profiles")
    .select("*")
    .eq("stylist_user_id", user.id)
    .maybeSingle();

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <p className="eyebrow mb-2">働きたいサロン環境</p>
      <h1 className="font-serif text-2xl font-bold text-ink">
        あなたが働きやすいと感じる
        <br />
        環境を教えてください
      </h1>
      <p className="mt-3 text-[13px] leading-relaxed text-charcoal">
        8つの質問に答えるだけです。あなたの才能を測る30問診断とは別の、
        「どんな職場が心地よいか」についての質問です。
      </p>

      <div className="mt-8">
        <StylistPreferenceWizard initialProfile={profile ?? null} />
      </div>

      <Link href="/stylist/mypage" className="mt-6 block text-center text-[13px] text-sub underline">
        マイページに戻る
      </Link>
    </main>
  );
}
