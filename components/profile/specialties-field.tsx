"use client";

import { useState, type ChangeEvent } from "react";
import { CheckboxGroupField } from "@/components/profile/checkbox-group-field";
import { isSpecialtiesOptional, SPECIALTIES_PHASE_CHANGED_MESSAGE } from "@/lib/profile/specialties-rule";

type Props = {
  options: readonly string[];
  defaultValues?: string[];
  errors?: string[];
  /** 「いまの立場」の現在の選択（未選択は空文字）。新卒のときだけ任意表示にする。 */
  phase: string;
};

/**
 * 得意技術。「いまの立場＝新卒」のときだけ「得意技術（任意）」とし、0件でも保存できる。
 * 選択済みの値は保持し、すべて外すこともできる（診断結果から自動入力はしない）。
 * 新卒から別の立場に切り替えて0件のままのときは、選択を案内する（保存時はサーバーでも検証する）。
 */
export function SpecialtiesField({ options, defaultValues = [], errors, phase }: Props) {
  const optional = isSpecialtiesOptional(phase);
  const [count, setCount] = useState(defaultValues.length);
  const [wasNewGrad, setWasNewGrad] = useState(optional);
  if (optional && !wasNewGrad) setWasNewGrad(true);
  const onChange = (e: ChangeEvent<HTMLDivElement>) => {
    const root = e.currentTarget;
    setCount(root.querySelectorAll('input[name="specialties"]:checked').length);
  };
  const guide = !optional && phase !== "" && wasNewGrad && count === 0;
  return (
    <div onChange={onChange} data-testid="specialties-field">
      <CheckboxGroupField
        name="specialties"
        label={optional ? "得意技術（任意）" : "得意技術"}
        options={options}
        defaultValues={defaultValues}
        errors={errors}
      />
      {guide && (
        <p role="status" className="mt-1.5 text-[12.5px] text-[#8A2E2E]" data-testid="specialties-guide">
          {SPECIALTIES_PHASE_CHANGED_MESSAGE}
        </p>
      )}
    </div>
  );
}
