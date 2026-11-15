import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { getDiagnosisChangeStatus } from "@/lib/diagnosis-limit/status";
import { formatJstDateTime } from "@/lib/diagnosis-limit/messages";
import { readOwnCareerPhase } from "@/lib/student-diagnosis/career-phase";
import { submitStudentDiagnosisAction } from "@/lib/student-diagnosis/actions";
import { StudentQuiz } from "@/components/student-diagnosis/student-quiz";
import type { StudentAnswers } from "@/lib/student-diagnosis/questions";

const shell = (children: React.ReactNode) => (
  <main className="mx-auto max-w-[560px] px-5 py-12">
    <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach</span><hr className="h-px flex-1 border-0 bg-line" /></div>
    {children}
  </main>
);

/** 新卒向け診断（ログイン必須）。0071が未適用のDBでは、まだ利用できない案内だけを出す（診断は始めない）。 */
export default async function StudentDiagnosisPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/stylist/diagnosis/student");
  if (await hasCompletedRole(supabase, user.id, "salon")) redirect("/salon/mypage");

  const support = await readOwnCareerPhase(supabase, user.id);
  if (support.status !== "ok") {
    return shell(
      <>
        <h1 className="font-serif text-xl font-bold text-ink">新卒の診断</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-charcoal">
          {support.status === "unsupported" ? "この診断は、まだご利用いただけません。" : "いま状態を確認できませんでした。しばらくしてからもう一度お試しください。"}
        </p>
        <Link href="/stylist/mypage" className="mt-6 inline-flex min-h-[44px] items-center text-[13px] text-sub underline">マイページに戻る</Link>
      </>,
    );
  }

  // 回数制限は経験者診断と同じ状態を共有する。ロック中は、答える前に案内する。
  const limit = await getDiagnosisChangeStatus(supabase, "stylist");
  if (limit.state === "locked" && limit.lockedUntil) {
    return shell(
      <>
        <h1 className="font-serif text-xl font-bold text-ink">いまは診断結果を変更できません</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-charcoal">
          次に変更できるのは {formatJstDateTime(limit.lockedUntil)} 以降です。新卒向けの診断と、現役の美容師向けの診断は、変更の回数を共有しています。
        </p>
        <Link href="/stylist/diagnosis/student/result" className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface">いまの結果を見る</Link>
      </>,
    );
  }
  const notices = [
    "この診断と、現役の美容師向けの診断は、保存した結果の「変更」の回数を共有しています。保存した結果を変えると、次に変更できるまで3か月あきます。",
  ];
  async function submit(answers: StudentAnswers, requestId: string) {
    "use server";
    return submitStudentDiagnosisAction(answers, requestId);
  }
  return shell(
    <>
      <h1 className="mb-5 font-serif text-xl font-bold text-ink">新卒の診断</h1>
      <StudentQuiz submit={submit} resultHref="/stylist/diagnosis/student/result" cancelHref="/stylist/mypage" notices={notices} />
    </>,
  );
}
