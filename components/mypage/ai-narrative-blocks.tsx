import type { AiOutputType } from "@/types/database";

type Props = {
  aiByType: Partial<Record<AiOutputType, unknown>>;
  isGenerating: boolean;
};

const BLOCKS: { key: AiOutputType; icon: string; title: string }[] = [
  { key: "essence", icon: "✨", title: "AIからひとこと" },
  { key: "explanation", icon: "🔍", title: "詳細分析" },
  { key: "advice", icon: "🚶", title: "次の一歩" },
  { key: "growth", icon: "🌱", title: "将来の可能性" },
];

/**
 * AI解説を4ブロックへ整理して表示する（診断体験120点化Sprint）。
 *
 * ★AI生成ロジック・生成される文章自体には一切手を加えていない。
 * 既存の diagnosis_ai_outputs（essence/explanation/advice/growth の4種、
 * 元々このデータ構造だった）を、スマホで読みやすいカード単位に分けて
 * 見せているだけ（見せ方のみの変更）。
 */
export function AiNarrativeBlocks({ aiByType, isGenerating }: Props) {
  if (isGenerating) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-6 text-center">
        <p className="text-[13.5px] text-sub">AI解説を生成しています。しばらくしてから再度ご確認ください。</p>
      </section>
    );
  }

  const blocksToShow = BLOCKS.filter((b) => {
    const value = aiByType[b.key];
    return typeof value === "string" ? value.length > 0 : Array.isArray(value) && value.length > 0;
  });

  if (blocksToShow.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {blocksToShow.map((block) => {
        const value = aiByType[block.key];
        return (
          <section key={block.key} className="rounded-2xl border border-line bg-surface p-6">
            <div className="mb-3 flex items-center gap-2">
              <span aria-hidden className="text-[18px]">
                {block.icon}
              </span>
              <p className="eyebrow">{block.title}</p>
            </div>
            {Array.isArray(value) ? (
              <ul className="list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-charcoal">
                {value.map((item, i) => (
                  <li key={i}>{String(item)}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] leading-relaxed text-charcoal">{String(value)}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
