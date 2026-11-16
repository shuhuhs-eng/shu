import Link from "next/link";
import { CORE_TYPE_CONTENT } from "@/lib/diagnosis/core-type-content";
import { NEWGRAD_COMMON_NOTE, NEWGRAD_RESULT_HEADING, NEWGRAD_TYPE_CONTENT } from "@/lib/diagnosis/newgrad-content";
import { CharacterStage } from "@/components/character/character-stage";
import type { CoreTypeCode } from "@/lib/diagnosis/core-types";

/**
 * 新卒版（これから美容師として働く人向け）のマイページ表示。
 * 能力・経験・年収・市場価値の表現、6軸の数値グラフ、経験者向けの12タイプ文・才能説明・星評価は出さない。
 * キャラクター名・画像・8タイプコードは経験者版と共通。
 */
export function NewgradResult({ coreTypeCode }: { coreTypeCode: CoreTypeCode }) {
  const base = CORE_TYPE_CONTENT[coreTypeCode];
  const c = NEWGRAD_TYPE_CONTENT[coreTypeCode];
  return (
    <>
      <section className="flex flex-col items-center px-2 pb-8 pt-6 text-center" data-testid="newgrad-header">
        <div className="mb-6">
          <CharacterStage coreTypeCode={coreTypeCode} legacySrc={base.characterImagePath} alt={base.name} stageClassName="w-56 sm:w-60" legacyClassName="h-48 w-48 sm:h-56 sm:w-56" />
        </div>
        <p className="eyebrow text-sub">{NEWGRAD_RESULT_HEADING}</p>
        <h1 className="mt-3 flex items-center justify-center gap-2 font-serif text-[30px] font-bold leading-tight sm:text-[36px]" style={{ color: base.primaryColor }}>
          <span aria-hidden="true">{base.icon}</span>
          {base.name}
        </h1>
        <p className="mt-5 max-w-[300px] text-[17px] font-semibold leading-relaxed text-ink">{c.headline}</p>
        <p className="mt-3 max-w-[320px] text-[13.5px] leading-relaxed text-charcoal">{c.body}</p>
        <p className="mt-2 max-w-[320px] text-[12px] leading-relaxed text-sub">{NEWGRAD_COMMON_NOTE}</p>
      </section>
      <section className="rounded-2xl border border-line bg-surface p-6">
        <p className="eyebrow mb-2">表示する傾向</p>
        <p className="text-[14px] leading-relaxed text-ink">{c.tendency}</p>
        <p className="eyebrow mb-2 mt-5">試してみること</p>
        <p className="text-[14px] leading-relaxed text-ink">{c.tryThis}</p>
      </section>
    </>
  );
}

/** プロフィールの「いまの立場」と診断の選択が違うときの案内。診断の結果から立場を自動で変えることはしない（本人がプロフィールで選ぶ）。 */
export function PhaseMismatchNotice({ kind, profileLabel }: { kind: "newgrad_diagnosis" | "experienced_diagnosis"; profileLabel: string | null }) {
  const diag = kind === "newgrad_diagnosis" ? "「新卒・これから美容師として働く」" : "現役の美容師向け";
  return (
    <p role="status" data-testid="phase-mismatch-notice" className="mt-4 rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] leading-relaxed text-charcoal">
      診断では{diag}を選びましたが、プロフィールの「いまの立場」は{profileLabel ? `「${profileLabel}」` : "未選択"}です。立場は診断では変わりません。変えたいときは、
      <Link href="/stylist/profile" className="font-semibold underline">プロフィール編集</Link>
      でご自身で選んでください。
    </p>
  );
}
