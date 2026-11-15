import Link from "next/link";
import { CAREER_PHASE_RESELECT_NOTE, CAREER_PHASE_UNSET_TEXT, describeCareerPhase, type CareerPhaseValue } from "@/lib/student-diagnosis/career-phase";

/** 新卒向け診断の結果への導線の種類。current=現在の結果／past=過去の結果／none=まだ受けていない。 */
export type StudentLinkKind = "current" | "past" | "none";

const LINK_LABEL: Record<StudentLinkKind, string> = {
  current: "新卒の診断結果を見る",
  past: "過去の新卒診断の結果を見る（現在の結果ではありません）",
  none: "新卒の診断を受ける",
};

/**
 * マイページ用の「いまの立場」と新卒診断への導線（本人のみ）。経験者向けの診断結果の表示の有無に左右されず、常に同じ位置に出す。
 * 未選択（旧データの未設定・美容学生を含む）のときは「未選択」と表示し、選び直してもらう（経験者とは書かない）。
 * 新卒の診断を「受ける」入口は、立場が新卒のときだけ出す。受けた結果（現在・過去）へのリンクは、立場にかかわらず残す。
 */
export function CareerPhaseSummary({ value, studentLink }: { value: CareerPhaseValue; studentLink: StudentLinkKind }) {
  const lines = describeCareerPhase(value);
  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-5" data-testid="career-phase-summary">
      <p className="eyebrow mb-1">いまの立場</p>
      {lines ? <ul className="space-y-0.5 text-[14px] text-ink">{lines.map((l) => <li key={l}>{l}</li>)}</ul> : <div><p className="text-[14px] text-sub" data-testid="career-phase-unset">{CAREER_PHASE_UNSET_TEXT}</p><p className="mt-1 text-[12.5px] leading-relaxed text-charcoal">{CAREER_PHASE_RESELECT_NOTE}</p></div>}
      <div className="mt-3 flex flex-col gap-x-5 sm:flex-row sm:flex-wrap">
        <Link href="/stylist/profile" className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-ink underline">{lines ? "変更する" : "選ぶ"}</Link>
        {(studentLink !== "none" || value.phase === "new_graduate") && (
          <Link href={studentLink === "none" ? "/stylist/diagnosis/student" : "/stylist/diagnosis/student/result"} className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-ink underline">{LINK_LABEL[studentLink]}</Link>
        )}
      </div>
    </section>
  );
}
