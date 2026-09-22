import { TRAITS, type TraitScores } from "@/lib/diagnosis";

/**
 * 6才能スコアのバー表示。DBの行形式(craft_score等の個別列)にもcomputeDiagnosis()の
 * 戻り値(scores: TraitScores)にも依存しない、TraitScoresオブジェクトのみを受け取る
 * 汎用コンポーネント。マイページ（components/mypage/diagnosis-summary.tsx）と
 * ゲスト診断結果画面（app/diagnosis/result/page.tsx）の両方から共用する。
 */
export function TraitScoreBars({ scores }: { scores: TraitScores }) {
  return (
    <div className="space-y-2">
      {TRAITS.map((t) => {
        const value = scores[t.key];
        return (
          <div key={t.key} className="flex items-center gap-3">
            <span className="w-10 shrink-0 text-[12px] text-sub">{t.jp}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface2">
              <div className="h-full rounded-full" style={{ width: `${value}%`, background: t.color }} />
            </div>
            <span className="w-8 shrink-0 text-right text-[12px] text-sub">{value}</span>
          </div>
        );
      })}
    </div>
  );
}
