import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { logError } from "@/lib/security/log";
import { computeStudentResult } from "@/lib/student-diagnosis/result";
import { STUDENT_DIAGNOSIS_VERSION, isValidStudentAnswers } from "@/lib/student-diagnosis/questions";
import { readCurrentDiagnosis } from "@/lib/student-diagnosis/current";
import { loadStudentResultForPage } from "@/lib/student-diagnosis/current-results";
import { StudentResultView } from "@/components/student-diagnosis/student-result-view";

/** 学生・新卒診断の結果（本人のみ。RLSで本人の行だけ読める）。保存済みの回答から表示用の結果を作り直す。 */
export default async function StudentDiagnosisResultPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/stylist/diagnosis/student/result");
  if (await hasCompletedRole(supabase, user.id, "salon")) redirect("/salon/mypage");

  // 現在の診断（bank と result_id）を基準に取得する。日時順の先頭では代用しない。
  // 現在が学生・新卒: result_id 指定／現在が経験者: 過去の学生結果（日時の新しい順）を「過去」と明示／行なし・履歴あり: 不整合として案内。
  const read = await readCurrentDiagnosis(supabase, user.id);
  const load = await loadStudentResultForPage(supabase, user.id, read);
  if (load.kind === "error" || load.kind === "unavailable") logError("studentResult.read", new Error(load.kind));
  const row = load.kind === "current" || load.kind === "past" ? load.row : null;
  const valid = !!row && isValidStudentAnswers(row.answers);
  const status = load.kind === "current" || load.kind === "past" ? load.kind : null;
  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <h1 className="mb-5 font-serif text-xl font-bold text-ink">{status === "past" ? "過去の学生・新卒診断の結果" : "美容学生・新卒の診断結果"}</h1>
      {status === "past" && (
        <p role="status" data-testid="past-result-notice" className="mb-5 rounded-xl border border-[#C98A1B]/40 bg-[#C98A1B]/[0.08] px-4 py-3 text-[13px] leading-relaxed text-[#7A5410]">
          <span className="font-bold">【現在の結果ではありません】</span>
          これは、以前に受けた学生・新卒診断の結果です。現在の診断は、現役の美容師向けの診断です。
        </p>
      )}
      {valid ? (
        <StudentResultView result={computeStudentResult(row!.answers as never, row!.version ?? STUDENT_DIAGNOSIS_VERSION)} />
      ) : (
        <div className="rounded-2xl border border-line bg-surface p-5 text-[14px] leading-relaxed text-charcoal">
          {load.kind === "error" || load.kind === "unavailable" || (row && !valid)
            ? "いま結果を読み込めませんでした。しばらくしてからもう一度お試しください。"
            : load.kind === "inconsistent"
              ? "診断の履歴はありますが、現在の診断の記録が見つかりませんでした。古い結果を現在の結果として表示しないよう、表示を止めています。しばらくしてから開き直しても変わらないときは、お問い合わせください。"
              : "まだ診断結果がありません。"}
          {load.kind === "none" && (
            <Link href="/stylist/diagnosis/student" className="mt-4 flex min-h-[44px] items-center justify-center rounded-full bg-ink px-6 py-3 text-[14px] font-semibold text-surface">診断を始める</Link>
          )}
        </div>
      )}
      <div className="mt-8 text-center"><Link href="/stylist/mypage" className="text-[13px] text-sub underline">マイページに戻る</Link></div>
    </main>
  );
}
