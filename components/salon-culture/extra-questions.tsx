"use client";

import { FivePointScale } from "@/components/shared/five-point-scale";
import { SCENES, SUPPLEMENT_TITLES } from "@/lib/salon-culture/analysis/scenes";
import { SUPPLEMENT_KEYS, type SupplementAnswers, type SupplementKey, type SupplementValue } from "@/lib/salon-culture/analysis/v1";

type Props = {
  values: Partial<SupplementAnswers>;
  onChange: (key: SupplementKey, v: SupplementValue) => void;
  disabled?: boolean;
};

/**
 * 追加5問の質問部分（追加5問の単独画面と、診断内容の更新フローで共通）。質問文・選択肢・「当てはまらない」は
 * これまでの追加5問画面と同じ。回答の保存・確定はここでは行わない。
 */
export function ExtraQuestions({ values, onChange, disabled = false }: Props) {
  return (
    <>
      {SUPPLEMENT_KEYS.map((key, i) => {
        const scene = SCENES[key];
        const value = values[key];
        const isNa = value === "na";
        return (
          <section key={key} className="rounded-2xl border border-line bg-surface p-5">
            <p className="eyebrow mb-2">追加の質問 {i + 1} / {SUPPLEMENT_KEYS.length}</p>
            <h2 className="text-[14.5px] font-bold leading-relaxed text-ink">{SUPPLEMENT_TITLES[key]}</h2>
            <div className="mt-4">
              <FivePointScale
                leftLabel={scene.low}
                rightLabel={scene.high}
                value={typeof value === "number" ? value : undefined}
                onChange={(n) => onChange(key, n as 1 | 2 | 3 | 4 | 5)}
                disabled={disabled}
              />
              <button
                type="button"
                disabled={disabled}
                aria-pressed={isNa}
                onClick={() => onChange(key, "na")}
                className={`mt-4 min-h-[44px] w-full rounded-full border px-4 py-2.5 text-[13px] font-semibold disabled:opacity-60 ${
                  isNa ? "border-ink bg-ink text-surface" : "border-line bg-surface text-charcoal"
                }`}
              >
                当てはまらない
              </button>
            </div>
          </section>
        );
      })}
    </>
  );
}

/** 追加5問の回答を、確認画面用に短い文字へ（1〜5 / 当てはまらない / 未回答）。 */
export function extraValueLabel(v: SupplementValue | undefined): string {
  if (v === "na") return "当てはまらない";
  return typeof v === "number" ? `${v} / 5` : "未回答";
}
