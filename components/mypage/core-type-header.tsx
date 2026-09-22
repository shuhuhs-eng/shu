import { CORE_TYPE_CONTENT } from "@/lib/diagnosis/core-type-content";
import type { StylistCoreType } from "@/types/database";

type Props = {
  coreTypeCode: StylistCoreType;
};

/**
 * 8タイプ（front-facing称号）のHeroセクション。
 *
 * ★「でした。」という結果通知的な表現をやめ、「自分の才能を発見した」と
 * 感じ、続きを読みたくなる構成に変更した：
 *   ①「あなたの才能タイプは」（共通ラベル）
 *   ②アイコン＋タイプ名
 *   ③そのタイプ専用のキャッチコピー（heroHeadline、対比構造の2行）
 *   ④「まだ本人が気づいていない才能」を示す一文（hiddenTalent）
 * この4要素はすべて CORE_TYPE_CONTENT の静的データを8タイプ共通の
 * テンプレートで描画しているだけで、タイプ別の固定文章をコンポーネント側に
 * 書いてはいない（8タイプすべてで同じ構造）。
 *
 * ★name・characterName・primaryColor・icon・characterImagePathは既存の
 * データをそのまま使用（primaryColorはタイプ名の文字色、iconはタイプ名の
 * 直前に表示——これまで未使用だったこの2項目を今回から表示に反映する）。
 * キャラクター画像の表示部分（下記div）は今回一切変更していない。
 *
 * ※プレースホルダーがSVGのため、next/imageのSVG最適化制限（next.config側の
 * 追加設定が必要になる）を避け、素の<img>タグで表示する。
 */
export function CoreTypeHeader({ coreTypeCode }: Props) {
  const content = CORE_TYPE_CONTENT[coreTypeCode];

  return (
    <section className="flex flex-col items-center px-2 pb-10 pt-6 text-center">
      <div className="relative mb-8 h-48 w-48 sm:h-56 sm:w-56">
        <div className="absolute inset-0 rounded-full bg-gradient-to-b from-[var(--gold)]/15 to-transparent blur-xl" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={content.characterImagePath}
          alt={content.name}
          className="relative h-full w-full object-contain drop-shadow-sm"
        />
      </div>

      <p className="eyebrow text-sub">あなたの才能タイプは</p>
      <h1
        className="mt-3 flex items-center justify-center gap-2 font-serif text-[30px] font-bold leading-tight sm:text-[36px]"
        style={{ color: content.primaryColor }}
      >
        <span aria-hidden="true">{content.icon}</span>
        {content.name}
      </h1>

      <p className="mt-6 max-w-[300px] text-[17px] font-semibold leading-relaxed text-ink">
        {content.heroHeadline.split("\n").map((line, i) => (
          <span key={i} className="block">
            {line}
          </span>
        ))}
      </p>

      <p className="mt-4 max-w-[280px] text-[14px] leading-relaxed text-charcoal">{content.hiddenTalent}</p>
    </section>
  );
}
