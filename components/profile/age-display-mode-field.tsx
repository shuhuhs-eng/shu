"use client";

import { useState } from "react";
import { AGE_DISPLAY_MODES, type AgeDisplayMode } from "@/lib/profile/birth-date";

type Props = {
  /** 未選択は空文字。既存会員を勝手に「実年齢」にしない（初回の選択は本人に求める）。 */
  defaultValue: AgeDisplayMode | "";
  errors?: string[];
};

/**
 * サロンへの年齢の表示方法（必須の初回選択）。実年齢（例: 45歳）か、年代（例: 40代）。
 * 年代を選んでも、サロンは「実年齢の開示」を依頼でき、本人が承認したサロンにだけ実年齢が表示される。
 * 生年月日そのものは、どちらを選んでもサロンに表示されない。
 */
export function AgeDisplayModeField({ defaultValue, errors }: Props) {
  const [value, setValue] = useState<AgeDisplayMode | "">(defaultValue);
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-semibold text-ink">サロンへの年齢の表示方法</legend>
      <div className="space-y-2">
        {AGE_DISPLAY_MODES.map((o) => {
          const checked = value === o.value;
          return (
            <label
              key={o.value}
              className={`flex min-h-[48px] cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 ${checked ? "border-ink bg-surface2" : "border-line bg-surface"}`}
            >
              <input
                type="radio"
                name="ageDisplayMode"
                value={o.value}
                checked={checked}
                onChange={() => setValue(o.value)}
                className="mt-1 h-4 w-4 accent-[var(--ink,#222)]"
              />
              <span>
                <span className="block text-[14px] font-semibold text-ink">
                  {o.label}
                  <span className="ml-2 text-[12px] font-normal text-sub">{o.example}</span>
                </span>
                {o.value === "decade" && (
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-sub">
                    サロンから実年齢の開示を依頼されることがあります。承認したサロンにだけ実年齢が表示され、辞退・未回答のあいだは年代のままです。
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {value === "" && <p className="mt-1.5 text-[12px] leading-relaxed text-sub">選択するまで、サロン向けの一覧には表示されません。</p>}
      {errors && errors.length > 0 && <p className="mt-1 text-[12px] text-[#C24545]">{errors[0]}</p>}
    </fieldset>
  );
}
