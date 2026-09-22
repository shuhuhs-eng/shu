import { fullType, type TypeId, type TraitScores } from "@/lib/diagnosis";
import { TraitScoreBars } from "@/components/diagnosis/trait-score-bars";
import type { AiOutputType, Database } from "@/types/database";

type DiagnosisResultRow = Database["public"]["Tables"]["diagnosis_results"]["Row"];

type Props = {
  latest: DiagnosisResultRow | null;
  aiByType: Partial<Record<AiOutputType, unknown>>;
  /**
   * 12タイプの見出し（診断タイプ名・キャッチコピー）を表示するかどうか。
   * 美容師マイページでは8タイプ（front-facing称号）を別コンポーネントで
   * 前面表示するため、こちらは false にして12タイプ名の重複表示を避ける
   * （12タイプ自体は内部詳細レイヤーとしてDBに保持し続ける。表示から
   * 外すだけで削除はしない）。サロンマイページでは従来どおり true のまま。
   * デフォルトは true（既存の見た目を変えない）。
   */
  showTypeHeader?: boolean;
  /**
   * 「AIによる解説」セクションを表示するかどうか。デフォルトはtrue
   * （既存の見た目を変えない。美容師マイページはこのpropを指定していない
   * ため、挙動は一切変わらない）。サロンマイページでは、サロン専用AI
   * （SalonAiNarrativeコンポーネント）と二重表示にならないよう falseにし、
   * この共通コンポーネント側のAI解説（美容師AI/旧サロン向け誤生成AI）を
   * 非表示にする。
   */
  showAiSection?: boolean;
};

/**
 * 診断結果（タイプ・6才能スコア・市場価値・AI解説）の表示。
 * stylist/salon共通のdiagnosis_resultsテーブルを前提としており、
 * modeに関わらず同じ見た目で表示する（app/mypage/page.tsxから
 * stylist/salon両方のマイページで共用する）。
 */
export function DiagnosisSummary({ latest, aiByType, showTypeHeader = true, showAiSection = true }: Props) {
  if (!latest) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 text-center">
        <p className="text-[14px] text-charcoal">まだ診断結果がありません。</p>
      </div>
    );
  }

  const type = fullType(latest.type_id as TypeId);
  const advice = Array.isArray(aiByType.advice) ? (aiByType.advice as string[]) : null;
  const scores: TraitScores = {
    T: latest.craft_score,
    S: latest.sense_score,
    H: latest.hospitality_score,
    B: latest.brand_score,
    A: latest.drive_score,
    M: latest.mentor_score,
  };

  const hasAiContent =
    typeof aiByType.essence === "string" ||
    typeof aiByType.explanation === "string" ||
    advice ||
    typeof aiByType.growth === "string";

  return (
    <div className="space-y-6">
      {showTypeHeader && (
        <section className="rounded-2xl border border-line bg-surface p-6">
          <p className="eyebrow mb-1">診断タイプ</p>
          <h2 className="font-serif text-xl font-bold text-ink">{latest.type_name}</h2>
          {type && <p className="mt-2 text-[13.5px] leading-relaxed text-charcoal">{type.line}</p>}
        </section>
      )}

      <section className="rounded-2xl border border-line bg-surface p-6">
        <p className="eyebrow mb-3">6才能スコア</p>
        <TraitScoreBars scores={scores} />
      </section>

      {latest.market_value_score != null && (
        <section className="rounded-2xl border border-line bg-surface p-6">
          <p className="eyebrow mb-1">市場価値（参考値）</p>
          <p className="font-data text-2xl font-bold text-ink">{latest.market_value_score}</p>
          {latest.salary_band && (
            <p className="mt-1 text-[13px] text-sub">想定年収帯: {latest.salary_band}</p>
          )}
        </section>
      )}

      {showAiSection &&
        (latest.ai_status === "PENDING" || latest.ai_status === "GENERATING" ? (
          <section className="rounded-2xl border border-line bg-surface p-6 text-center">
            <p className="text-[13.5px] text-sub">AI解説を生成しています。しばらくしてから再度ご確認ください。</p>
          </section>
        ) : (
          hasAiContent && (
            <section className="rounded-2xl border border-line bg-surface p-6">
              <p className="eyebrow mb-3">AIによる解説</p>
              {typeof aiByType.essence === "string" && (
                <p className="text-[13.5px] leading-relaxed text-charcoal">{aiByType.essence}</p>
              )}
              {typeof aiByType.explanation === "string" && (
                <p className="mt-3 text-[13.5px] leading-relaxed text-charcoal">{aiByType.explanation}</p>
              )}
              {advice && advice.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-[13.5px] leading-relaxed text-charcoal">
                  {advice.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
              {typeof aiByType.growth === "string" && (
                <p className="mt-3 text-[13.5px] leading-relaxed text-charcoal">{aiByType.growth}</p>
              )}
            </section>
          )
        ))}
    </div>
  );
}
