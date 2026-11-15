import { describeStudentResult, studentNextSteps, type StudentResult } from "@/lib/student-diagnosis/result";
import { CONCERN_LABEL, ENV_LABEL, INTEREST_LABEL, VALUE_PRIORITY_LABELS } from "@/lib/student-diagnosis/questions";

/** 学生・新卒診断の結果表示。点数・割合・順位は出さない。能力は断定しない。同数のタグは同列（チップ）で並べる。 */
export function StudentResultView({ result }: { result: StudentResult }) {
  const d = describeStudentResult(result);
  const steps = studentNextSteps(result);
  const chip = "inline-flex items-center rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-ink";
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-surface p-5">
        <p className="eyebrow mb-1">興味</p>
        <p className="text-[14px] leading-relaxed text-ink">{d.interest}</p>
        {!result.interests.balanced && !result.interests.weak && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="興味（同程度）">
            {[...result.interests.top, ...result.interests.next].map((t) => <li key={t} className={chip}>{INTEREST_LABEL[t]}</li>)}
          </ul>
        )}
      </section>
      <section className="rounded-2xl border border-line bg-surface p-5">
        <p className="eyebrow mb-1">学びたいこと</p>
        <p className="text-[14px] leading-relaxed text-ink">{d.learning}</p>
      </section>
      <section className="rounded-2xl border border-line bg-surface p-5">
        <p className="eyebrow mb-1">大切にしたい働き方</p>
        <ol className="mt-1 space-y-1.5 text-[14px] text-ink">
          {result.values.map((c, i) => <li key={c}>{i + 1}. {VALUE_PRIORITY_LABELS[c] ?? c}</li>)}
        </ol>
      </section>
      <section className="rounded-2xl border border-line bg-surface p-5">
        <p className="eyebrow mb-1">合いやすい教育環境</p>
        <p className="text-[14px] leading-relaxed text-ink">{d.env}</p>
        {!result.env.balanced && !result.env.weak && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="合いやすい教育環境（同程度）">
            {[...result.env.top, ...result.env.next].map((t) => <li key={t} className={chip}>{ENV_LABEL[t].name}</li>)}
          </ul>
        )}
      </section>
      {result.concerns.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-5">
          <p className="eyebrow mb-1">不安に感じていること</p>
          <ul className="mt-2 flex flex-wrap gap-2">{result.concerns.map((c) => <li key={c} className={chip}>{CONCERN_LABEL[c]}</li>)}</ul>
        </section>
      )}
      <section className="rounded-2xl border border-line bg-surface2 p-5">
        <p className="eyebrow mb-2">次の一手</p>
        <ul className="space-y-2 text-[13.5px] leading-relaxed text-charcoal">{steps.map((s) => <li key={s}>・{s}</li>)}</ul>
        <p className="mt-3 text-[12px] leading-relaxed text-sub">サロン見学の申込は運営が仲介します。この結果は能力の評価ではなく、見学や相談で確かめるための手がかりです。</p>
      </section>
    </div>
  );
}
