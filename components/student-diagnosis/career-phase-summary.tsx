import Link from "next/link";
import { describeCareerPhase, type CareerPhaseValue } from "@/lib/student-diagnosis/career-phase";

/** マイページ用の区分の表示（本人のみ）。未設定のときは何も出さない（経験者とは書かない）。 */
export function CareerPhaseSummary({ value, hasStudentResult }: { value: CareerPhaseValue; hasStudentResult: boolean }) {
  const lines = describeCareerPhase(value);
  if (!lines && !hasStudentResult) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-5" data-testid="career-phase-summary">
      <p className="eyebrow mb-1">いまの立場</p>
      {lines && <ul className="space-y-0.5 text-[14px] text-ink">{lines.map((l) => <li key={l}>{l}</li>)}</ul>}
      <div className="mt-3 flex flex-wrap gap-x-5">
        <Link href="/stylist/profile" className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-ink underline">変更する</Link>
        {hasStudentResult && <Link href="/stylist/diagnosis/student/result" className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-ink underline">学生・新卒の診断結果を見る</Link>}
      </div>
    </section>
  );
}
