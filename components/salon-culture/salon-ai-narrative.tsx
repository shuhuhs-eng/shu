import type { AiOutputType } from "@/types/database";

type Props = {
  aiByType: Partial<Record<AiOutputType, unknown>>;
};

/**
 * サロン専用AI解説の表示。components/mypage/diagnosis-summary.tsx（美容師と
 * 共用）とは完全に独立したコンポーネント。DiagnosisSummary自体は一切変更
 * していない（showAiSection={false}で美容師/旧サロン向け誤生成AIのブロックを
 * 非表示にした上で、こちらを別途表示する）。
 *
 * ここで表示する aiByType は、呼び出し元（app/salon/mypage/page.tsx）が
 * salon_culture_ai_outputs（0012_salon_culture_ai_outputs.sql、
 * diagnosis_ai_outputsとは完全に別テーブル）から
 * prompt_version="salon-culture-v1"・is_current=true で取得したものだけを
 * 渡す前提。美容師向けAI・旧サロン向け誤生成AI（別テーブルdiagnosis_ai_outputs）
 * は、テーブル自体が異なるため一切混ざらない。
 *
 * ★salon_culture_profilesにはdiagnosis_results.ai_statusに相当する
 * 生成中/完了/失敗のステータス列が存在しないため、「生成中です」という
 * 表示は行わない（該当データが無ければ単純に「回答すると表示されます」
 * という案内にとどめる）。
 */
export function SalonAiNarrative({ aiByType }: Props) {
  const essence = typeof aiByType.essence === "string" ? aiByType.essence : null;
  const explanation = typeof aiByType.explanation === "string" ? aiByType.explanation : null;
  const advice = Array.isArray(aiByType.advice) ? (aiByType.advice as string[]) : null;
  const growth = typeof aiByType.growth === "string" ? aiByType.growth : null;
  const hasContent = essence || explanation || (advice && advice.length > 0) || growth;

  if (!hasContent) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-6 text-center">
        <p className="text-[13.5px] leading-relaxed text-charcoal">
          サロンらしさを回答すると、AIによるサロン紹介文が表示されます。
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <p className="eyebrow mb-3">AIによるサロン紹介</p>
      {essence && <p className="text-[13.5px] leading-relaxed text-charcoal">{essence}</p>}
      {explanation && <p className="mt-3 text-[13.5px] leading-relaxed text-charcoal">{explanation}</p>}
      {advice && advice.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[13.5px] leading-relaxed text-charcoal">
          {advice.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
      {growth && <p className="mt-3 text-[13.5px] leading-relaxed text-charcoal">{growth}</p>}
    </section>
  );
}
