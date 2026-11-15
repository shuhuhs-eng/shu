import Link from "next/link";
import { proposeValuePriorities, valueLabel } from "@/lib/profile/apply-diagnosis-values";

/**
 * 診断結果の「大切にしたい働き方」の変更案。プロフィールの「サロン選びで大切にしたいこと」との比較を見せる。
 * ★この画面からの保存は一時停止中（保存関数がプロフィール全項目を受け取る方式で、別画面の編集と重なると他の項目を上書きしうるため）。
 *   value_priorities だけを更新する専用の保存関数（0072の草案）が適用されるまで、変更案の表示とプロフィール編集へのリンクだけを出す。
 *   何も保存しない（押せる保存ボタンはない）。診断の選択が3つに満たない場合も、推測で補わない。
 */
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
      <p className="text-[13px] leading-relaxed text-charcoal">この診断で選んだ「大切にしたい働き方」と、プロフィールの「サロン選びで大切にしたいこと」を比べられます。この画面では何も保存されません。</p>
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
      <button type="button" disabled aria-disabled="true" data-testid="apply-paused-button" className="mt-4 flex min-h-[48px] w-full cursor-not-allowed items-center justify-center rounded-full border border-line bg-surface2 px-6 py-3 text-[14px] font-semibold text-sub opacity-70">
        プロフィールに反映する（準備中）
      </button>
      <p className="mt-2 text-[12.5px] leading-relaxed text-charcoal" data-testid="apply-paused-note">この画面からの保存は、現在お休みしています。ほかの項目を誤って書き換えないための安全対策です。変更したいときは、プロフィール編集の「サロン選びで大切にしたいこと」で選び直してください。</p>
      <Link href="/stylist/profile" className="mt-1 inline-flex min-h-[44px] items-center text-[13px] font-semibold text-ink underline">{hasProfile ? "プロフィール編集へ" : "先にプロフィールを保存する"}</Link>
    </section>
  );
}
