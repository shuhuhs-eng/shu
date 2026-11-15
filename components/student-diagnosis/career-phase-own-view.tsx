import Link from "next/link";
import { describeCareerPhase, type CareerPhaseValue } from "@/lib/student-diagnosis/career-phase";

/**
 * 本人プレビューの「いまの立場」。本人だけに見せる欄で、サロン向けの表示とは別に出す。
 * 区分（美容学生・新卒・経験者・未設定）と、登録済みの卒業・就業開始の希望・免許の取得状況を確認できる。
 * 未設定は「未設定」と出す（経験者とは書かない）。サロン側には現在表示されないことを必ず明示する。
 * load: ok=読めた／error=読み込めない（未設定とは扱わない）。0071未適用（unsupported）のときは呼び出し側で出さない。
 */
export function CareerPhaseOwnView({ load }: { load: { status: "ok"; value: CareerPhaseValue } | { status: "error" } }) {
  const lines = load.status === "ok" ? describeCareerPhase(load.value) : null;
  return (
    <section aria-label="あなたのいまの立場（あなただけに表示）" data-testid="career-phase-own" className="mt-8 rounded-2xl border border-dashed border-line bg-surface2 p-5">
      <p className="eyebrow mb-1">いまの立場（あなただけに表示）</p>
      {load.status === "error" ? (
        <p role="alert" className="text-[13.5px] text-[#8A2E2E]">いまの立場を読み込めませんでした。時間をおいて、もう一度開いてください。</p>
      ) : lines ? (
        <ul className="space-y-0.5 text-[14px] text-ink">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
      ) : (
        <p className="text-[14px] text-sub">未設定</p>
      )}
      <p className="mt-3 text-[12.5px] font-semibold leading-relaxed text-charcoal" data-testid="career-phase-own-notice">この情報は現在サロン側には表示されません。</p>
      <Link href="/stylist/profile" className="mt-1 inline-flex min-h-[44px] items-center text-[13px] font-semibold text-ink underline">
        {load.status === "ok" && lines ? "変更する" : "設定する"}
      </Link>
    </section>
  );
}
