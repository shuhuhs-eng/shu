import Link from "next/link";
import { describeStudentResult, type StudentResult } from "@/lib/student-diagnosis/result";

/**
 * マイページに出す、現在の診断（学生・新卒）の要約。点数・割合・順位は出さない。
 * 過去の経験者診断の結果は現在の結果ではないため、ここには出さず、保存されていることだけを伝える（hasPastExperienced）。
 */
export function StudentCurrentCard({ result, hasPastExperienced }: { result: StudentResult; hasPastExperienced: boolean }) {
  const d = describeStudentResult(result);
  return (
    <section className="rounded-2xl border border-line bg-surface p-5" data-testid="student-current-card">
      <p className="eyebrow mb-1">いまの診断（美容学生・新卒向け）</p>
      <p className="text-[14px] leading-relaxed text-ink">{d.interest}</p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-charcoal">{d.env}</p>
      <Link href="/stylist/diagnosis/student/result" className="mt-3 inline-flex min-h-[44px] items-center text-[13px] font-semibold text-ink underline">結果をくわしく見る</Link>
      {hasPastExperienced && (
        <p className="mt-2 text-[12px] leading-relaxed text-sub">以前に受けた現役の美容師向けの診断の結果は保存されていますが、現在の結果ではないため、ここには表示していません。</p>
      )}
    </section>
  );
}
