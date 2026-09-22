type Props = {
  score: number;
  salaryBand: string | null;
};

/**
 * スコア(38〜97、lib/diagnosis/scoring.tsのmarketValue()が算出する既存の値)から
 * 星の数と定性メッセージを導く、表示専用のヘルパー。市場価値の算出ロジック
 * 自体（lib/diagnosis）には一切手を加えていない。
 *
 * 実データが蓄積されるまでは「上位○%」のようなパーセンタイル表示は行わない
 * （診断体験120点化Sprintの指示どおり）。
 */
function starsAndMessage(score: number): { stars: number; message: string } {
  if (score >= 85) return { stars: 5, message: "業界でもトップクラスの水準です" };
  if (score >= 70) return { stars: 4, message: "業界平均を上回っています" };
  if (score >= 55) return { stars: 3, message: "着実に力をつけています" };
  return { stars: 2, message: "これからの伸びしろがあります" };
}

function StarRow({ stars }: { stars: number }) {
  return (
    <span aria-hidden className="text-[18px] tracking-wide text-[var(--gold)]">
      {"★".repeat(stars)}
      <span className="text-line">{"★".repeat(5 - stars)}</span>
    </span>
  );
}

/**
 * 市場価値のカード表示（診断体験120点化Sprintによるリデザイン）。
 * ★算出ロジックには一切手を加えていない。既存の market_value_score /
 * salary_band をそのまま表示し、見せ方（カードUI・星評価・定性メッセージ）
 * だけを追加している。
 */
export function MarketValueCard({ score, salaryBand }: Props) {
  const { stars, message } = starsAndMessage(score);

  return (
    <section className="rounded-2xl border border-line bg-surface p-6 text-center">
      <p className="eyebrow mb-2">市場価値</p>
      <p className="font-data text-[40px] font-bold leading-none text-ink">{score}</p>
      <div className="mt-3">
        <StarRow stars={stars} />
      </div>
      <p className="mt-3 text-[13.5px] text-charcoal">{message}</p>
      {salaryBand && <p className="mt-1 text-[12px] text-sub">想定年収帯: {salaryBand}</p>}
    </section>
  );
}
