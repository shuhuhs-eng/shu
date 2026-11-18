"use client";

import { useState } from "react";
import { SALON_VISIBILITY_OPTIONS, toSalonVisibilityChoice, type SalonVisibilityChoice } from "@/lib/salon/store-visibility";

type Props = {
  /** DB の値（PUBLIC / PRIVATE / 既存の LIMITED など）か、新規入力の初期選択。画面の2択に写して表示する。 */
  defaultValue: string;
  name?: string;
  errors?: string[];
};

/**
 * 店舗プロフィールの公開範囲（公開／非公開の二択）。
 * 選択は React の状態で持ち、送信する値は hidden の入力に入れる。ボタンは入力欄ではないため、<form action> の完了後に
 * フォームが初期値へ戻る（React 19）ことがあっても、画面の選択と送信される値が食い違わない。
 */
export function SalonVisibilityField({ defaultValue, name = "visibility", errors }: Props) {
  const [value, setValue] = useState<SalonVisibilityChoice>(toSalonVisibilityChoice(defaultValue));
  return (
    <div role="radiogroup" aria-label="プロフィールの公開範囲">
      <p className="mb-2 text-[13px] font-semibold text-ink">プロフィールの公開範囲</p>
      <input type="hidden" name={name} value={value} />
      <div className="space-y-2">
        {SALON_VISIBILITY_OPTIONS.map((o) => {
          const checked = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={checked}
              data-value={o.value}
              onClick={() => setValue(o.value)}
              className={`flex min-h-[48px] w-full items-center gap-3 rounded-xl border px-4 py-3 text-left ${checked ? "border-ink bg-surface2" : "border-line bg-surface"}`}
            >
              <span aria-hidden className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${checked ? "border-ink" : "border-line"}`}>
                {checked && <span className="h-2 w-2 rounded-full bg-ink" />}
              </span>
              <span className="text-[14px] font-semibold text-ink">{o.label}</span>
            </button>
          );
        })}
      </div>
      {errors && errors.length > 0 && <p className="mt-1 text-[12px] text-[#C24545]">{errors[0]}</p>}
    </div>
  );
}
