import Link from "next/link";
import { CAREER_PHASE_LABEL, CAREER_PHASE_RESELECT_NOTE, CAREER_PHASE_UNSET_TEXT, type CareerPhaseValue } from "@/lib/student-diagnosis/career-phase";

/**
 * マイページの「いまの立場」カード。**表示だけ**（入力・保存・診断開始・変更のボタンやリンクは置かない）。
 * ・表示するのは**立場名だけ**（新卒／現役の美容師／ブランクあり）。卒業年月・ブランク期間などの詳細は、プロフィール編集と本人プレビューで表示する。
 * ・立場の変更は、プロフィール編集（既存の「プロフィール編集」）で、ほかの項目と一緒に保存する。
 * ・未選択（旧データの未設定・美容学生を含む）は「未選択」。経験者などに置き換えない。
 * ・読み込みに失敗したときは「読み込めませんでした」と表示し、未選択とは区別する。
 * load: ok=読めた／error=読み込めない。0071未適用（unsupported）のときは呼び出し側でカードごと出さない。
 */
export function CareerPhaseSummary({ load }: { load: { status: "ok"; value: CareerPhaseValue } | { status: "error" } }) {
  const label = load.status === "ok" && load.value.phase ? CAREER_PHASE_LABEL[load.value.phase] : null;
  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-5" data-testid="career-phase-summary">
      <p className="eyebrow mb-1">いまの立場</p>
      {load.status === "error" ? (
        <p role="alert" className="text-[14px] text-[#8A2E2E]" data-testid="career-phase-load-error">読み込めませんでした</p>
      ) : label ? (
        <p className="text-[14px] text-ink" data-testid="career-phase-label">{label}</p>
      ) : (
        <div>
          <p className="text-[14px] text-sub" data-testid="career-phase-unset">{CAREER_PHASE_UNSET_TEXT}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-charcoal">{CAREER_PHASE_RESELECT_NOTE}</p>
        </div>
      )}
      <p className="mt-3 text-[12px] leading-relaxed text-sub">立場の変更は、ページ下の「プロフィール編集」から行えます。</p>
    </section>
  );
}

/** 過去に受けた新卒向け診断の結果を見るリンク（現在の診断が現役向けのとき）。立場カードとは別の、診断まわりの導線。診断を始める・やり直す操作ではない。 */
export function StudentPastResultLink() {
  return (
    <div className="mt-4" data-testid="student-past-result-link">
      <Link href="/stylist/diagnosis/student/result" className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-ink underline">過去の新卒診断の結果を見る（現在の結果ではありません）</Link>
    </div>
  );
}
