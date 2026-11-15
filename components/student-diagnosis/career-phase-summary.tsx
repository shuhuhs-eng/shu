import Link from "next/link";
import { describeCareerPhase, type CareerPhaseValue } from "@/lib/student-diagnosis/career-phase";

/** 学生・新卒の結果への導線の種類。current=現在の結果／past=過去の結果／none=まだ受けていない。 */
export type StudentLinkKind = "current" | "past" | "none";

const LINK_LABEL: Record<StudentLinkKind, string> = {
  current: "学生・新卒の診断結果を見る",
  past: "過去の学生・新卒診断の結果を見る（現在の結果ではありません）",
  none: "学生・新卒の診断を受ける",
};

/**
 * マイページ用の「いまの立場」と学生・新卒診断への導線（本人のみ）。経験者向けの診断結果の表示の有無に左右されず、常に同じ位置に出す。
 * 未設定のときも「未設定」と表示する（経験者とは書かない）。
 */
export function CareerPhaseSummary({ value, studentLink }: { value: CareerPhaseValue; studentLink: StudentLinkKind }) {
  const lines = describeCareerPhase(value);
  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-5" data-testid="career-phase-summary">
      <p className="eyebrow mb-1">いまの立場</p>
      {lines ? <ul className="space-y-0.5 text-[14px] text-ink">{lines.map((l) => <li key={l}>{l}</li>)}</ul> : <p className="text-[14px] text-sub">未設定</p>}
      <div className="mt-3 flex flex-col gap-x-5 sm:flex-row sm:flex-wrap">
        <Link href="/stylist/profile" className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-ink underline">{lines ? "変更する" : "設定する"}</Link>
        <Link href={studentLink === "none" ? "/stylist/diagnosis/student" : "/stylist/diagnosis/student/result"} className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-ink underline">{LINK_LABEL[studentLink]}</Link>
      </div>
    </section>
  );
}
