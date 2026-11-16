import Link from "next/link";
import { proposeValuePriorities, valueLabel } from "@/lib/profile/apply-diagnosis-values";
import { ApplyValuesButton } from "@/components/student-diagnosis/apply-values-button";

/**
 * 診断結果の「大切にしたい働き方」の変更案。プロフィールの「サロン選びで大切にしたいこと」との比較を見せ、本人が押したときだけ反映する。
 * ・反映は専用関数 set_stylist_value_priorities（0072）で value_priorities の1列だけを更新する。ほかのプロフィール項目は更新しない。
 * ・診断の選択が3つに満たない場合は、推測で補わずボタンを押せなくし、プロフィール編集で選ぶよう案内する。
 * ・すでに同じ内容のときも押せない（無駄な更新をしない）。
 */
const sameValues = (a: string[] | null, b: string[]) => !!a && a.length === b.length && a.every((c, i) => c === b[i]);

export function ApplyValuesToProfile({
  diagnosisValues, current, hasProfile,
}: {
  diagnosisValues: string[];
  /** プロフィールに保存済みの値（順番が優先順位）。プロフィールが無いときは null */
  current: string[] | null;
  hasProfile: boolean;
}) {
  const { proposed, missing } = proposeValuePriorities(diagnosisValues);
  const list = (codes: string[] | null) =>
    codes && codes.length > 0 ? <ol className="mt-1 space-y-0.5 text-[13.5px] text-ink">{codes.map((c, i) => <li key={c}>{i + 1}. {valueLabel(c)}</li>)}</ol> : <p className="mt-1 text-[13px] text-sub">未設定</p>;
  return (
    <section className="rounded-2xl border border-line bg-surface p-5" data-testid="apply-values">
      <p className="eyebrow mb-1">プロフィールへの反映</p>
      <p className="text-[13px] leading-relaxed text-charcoal">この診断で選んだ「大切にしたい働き方」と、プロフィールの「サロン選びで大切にしたいこと」を比べて、反映するかどうかを選べます。自動では保存されません。</p>
      {hasProfile && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface2 p-3" data-testid="apply-current">
            <p className="text-[12px] font-bold text-sub">現在の設定（プロフィール）</p>
            {list(current)}
          </div>
          <div className="rounded-xl border border-line bg-surface2 p-3" data-testid="apply-proposed">
            <p className="text-[12px] font-bold text-sub">診断からの変更案</p>
            {list(proposed)}
            {missing > 0 && <p className="mt-2 text-[12px] leading-relaxed text-[#7A5410]" data-testid="apply-missing">診断では{proposed.length}つの選択でした。プロフィールは3つ選ぶため、あと{missing}つはプロフィール編集で選んでください（こちらで補うことはしません）。</p>}
          </div>
        </div>
      )}
      {hasProfile ? (
        <ApplyValuesButton
          proposed={proposed}
          disabledReason={missing > 0 ? `診断の選択が${proposed.length}つのため、ここでは反映できません。プロフィール編集で3つ選んでください。` : sameValues(current, proposed) ? "プロフィールの設定は、すでにこの内容です。" : null}
        />
      ) : null}
      <p className="mt-2 text-[12.5px] leading-relaxed text-charcoal" data-testid="apply-scope-note">反映されるのは「サロン選びで大切にしたいこと」だけです。ほかのプロフィール項目は変わりません。</p>
      <Link href="/stylist/profile" className="mt-1 inline-flex min-h-[44px] items-center text-[13px] font-semibold text-ink underline">{hasProfile ? "プロフィール編集へ" : "先にプロフィールを保存する"}</Link>
    </section>
  );
}
