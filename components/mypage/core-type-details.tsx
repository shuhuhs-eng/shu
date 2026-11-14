import { CORE_TYPE_CONTENT } from "@/lib/diagnosis/core-type-content";
import type { StylistCoreType } from "@/types/database";

type Props = {
  coreTypeCode: StylistCoreType;
};

function StarRow({ stars }: { stars: number }) {
  return (
    <span className="flex items-center gap-1.5 text-[13px] tracking-wide text-[var(--gold)]">
      <span aria-hidden="true">
        {"★".repeat(stars)}
        <span className="text-line">{"★".repeat(5 - stars)}</span>
      </span>
      <span className="text-[11px] text-sub">5段階中{stars}</span>
    </span>
  );
}

/**
 * 8タイプの「あなたに合いやすい職場」「向いている働き方」「このタイプの強み」（静的コンテンツ。AI生成ではない）。
 * マッチングへの接続を主役にするため、職場を先頭に置き、強みは簡潔なチップにして目立たせない。
 * 内容・データ・判定ロジックは変更していない（見せ方のみ）。星の数は「その環境との合いやすさ」の目安で、点数ではない。
 */
export function CoreTypeDetails({ coreTypeCode }: Props) {
  const content = CORE_TYPE_CONTENT[coreTypeCode];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line bg-surface p-6">
        <p className="eyebrow mb-1">あなたに合いやすい職場</p>
        <p className="mb-4 text-[12px] leading-relaxed text-sub">
          診断で出た「{content.name}」タイプの傾向から、強みが活きやすい環境の目安を並べています。
        </p>
        <div className="space-y-2.5">
          {content.environmentCards.map((card, i) => (
            <div key={i} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-surface2 px-4 py-3">
              <span className="flex items-center gap-2.5 text-[13.5px] font-medium text-charcoal">
                <span aria-hidden="true" className="text-[18px]">
                  {card.icon}
                </span>
                {card.label}
              </span>
              <StarRow stars={card.stars} />
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-sub">
          ※特定のサロンを推薦するものではありません。サロンごとの相性は「公開中の店舗を探す」で確認できます。
        </p>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-6">
        <p className="eyebrow mb-2">向いている働き方</p>
        <p className="text-[13.5px] leading-relaxed text-charcoal">{content.workStyle}</p>
      </section>

      <section className="px-1">
        <p className="mb-2 text-[12px] font-semibold text-sub">このタイプの強み</p>
        <ul className="flex flex-wrap gap-2">
          {content.strengthCards.map((card, i) => (
            <li key={i} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] text-charcoal">
              <span aria-hidden="true">{card.icon}</span>
              {card.label}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
