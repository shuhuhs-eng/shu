import { CORE_TYPE_CONTENT } from "@/lib/diagnosis/core-type-content";
import type { StylistCoreType } from "@/types/database";

type Props = {
  coreTypeCode: StylistCoreType;
};

function StarRow({ stars }: { stars: number }) {
  return (
    <span aria-hidden className="text-[13px] tracking-wide text-[var(--gold)]">
      {"★".repeat(stars)}
      <span className="text-line">{"★".repeat(5 - stars)}</span>
    </span>
  );
}

/**
 * 8タイプの「このタイプの強み」「向いている働き方」「あなたの強みが
 * 活きやすい環境傾向」を表示する。すべて静的コンテンツ（AI生成ではない）。
 * 診断体験120点化Sprintにより、強み・環境傾向をカードUIへ変更した
 * （見せ方のみの変更。データ自体・判定ロジックには一切手を加えていない）。
 *
 * 「環境傾向」は断定的な推薦表現を避け、あくまで参考情報として示す。
 * 本格的なマッチング（サロン提案）はここでは行わず、将来のマッチング
 * フェーズへの接続点として注記のみを表示する
 * （requirements-v1.0.md 4.1節参照）。
 */
export function CoreTypeDetails({ coreTypeCode }: Props) {
  const content = CORE_TYPE_CONTENT[coreTypeCode];

  return (
    <div className="space-y-6">
      <section>
        <p className="eyebrow mb-3">このタイプの強み</p>
        <div className="grid grid-cols-3 gap-3">
          {content.strengthCards.map((card, i) => (
            <div
              key={i}
              className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-5 text-center"
            >
              <span aria-hidden className="text-[26px]">
                {card.icon}
              </span>
              <span className="text-[12.5px] font-medium text-charcoal">{card.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-6">
        <p className="eyebrow mb-3">向いている働き方</p>
        <p className="text-[13.5px] leading-relaxed text-charcoal">{content.workStyle}</p>
      </section>

      <section>
        <p className="eyebrow mb-3">あなたの強みが活きやすい環境</p>
        <div className="space-y-2.5">
          {content.environmentCards.map((card, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-4"
            >
              <span className="flex items-center gap-2.5 text-[13.5px] text-charcoal">
                <span aria-hidden className="text-[18px]">
                  {card.icon}
                </span>
                {card.label}
              </span>
              <StarRow stars={card.stars} />
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-sub">
          ※特定のサロンを推薦するものではありません。本格的なマッチング機能は今後実装予定です。
        </p>
      </section>
    </div>
  );
}
