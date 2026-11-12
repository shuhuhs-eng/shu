import type { AiOutputType } from "@/types/database";
import { SalonAiGenerateButton } from "@/components/salon-culture/salon-ai-generate-button";

type Props = {
  aiByType: Partial<Record<AiOutputType, unknown>>;
  /** salon_culture_profiles.status（行が無ければ null）。 */
  cultureStatus: "draft" | "completed" | null;
  /** AI紹介文の取得そのものに失敗したか（未作成と区別して表示する）。 */
  loadFailed?: boolean;
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
 * ★salon_culture_profilesにはdiagnosis_results.ai_statusに相当する生成状態の列が無い。そのため
 * 「回答済みで紹介文が無い」場合は、生成待ち・生成失敗・過去に生成されなかったのいずれかを区別できない。
 * 未回答と同じ案内にはせず、回答済みであることと「作成する」操作を示す。
 */
export function SalonAiNarrative({ aiByType, cultureStatus, loadFailed = false }: Props) {
  const essence = typeof aiByType.essence === "string" ? aiByType.essence : null;
  const explanation = typeof aiByType.explanation === "string" ? aiByType.explanation : null;
  const advice = Array.isArray(aiByType.advice) ? (aiByType.advice as string[]) : null;
  const growth = typeof aiByType.growth === "string" ? aiByType.growth : null;
  const hasContent = essence || explanation || (advice && advice.length > 0) || growth;

  if (!hasContent) {
    if (loadFailed) {
      return (
        <section className="rounded-2xl border border-line bg-surface p-6 text-center">
          <p className="text-[13.5px] leading-relaxed text-charcoal">
            AI紹介文を読み込めませんでした。画面を更新してもう一度お試しください。
          </p>
        </section>
      );
    }
    if (cultureStatus === "completed") {
      return (
        <section className="rounded-2xl border border-line bg-surface p-6 text-center">
          <p className="text-[13.5px] leading-relaxed text-charcoal">
            サロンらしさは回答済みです。AIによるサロン紹介文は、まだ作成されていません。
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-sub">作成中の場合や、作成に失敗した場合があります。</p>
          <div className="flex justify-center">
            <SalonAiGenerateButton />
          </div>
        </section>
      );
    }
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
