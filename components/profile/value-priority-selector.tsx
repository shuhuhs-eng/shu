"use client";

import { useState } from "react";
import { FieldError } from "@/components/auth/form-messages";

type Option = { code: string; label: string };

type Props = {
  name: string;
  label: string;
  options: Option[];
  defaultValues?: string[];
  errors?: string[];
  /**
   * 選択が変わるたびに呼ばれる任意のコールバック。フォーム送信（hidden input）に
   * 依存せず、呼び出し元がReact stateとして選択結果を追跡したい場合に使う
   * （例: components/salon-culture/salon-culture-wizard.tsx）。
   * 既存の呼び出し元（stylist-onboarding-wizard.tsx等）は渡さないため、
   * 挙動は変わらない（後方互換）。
   */
  onChange?: (selected: string[]) => void;
};

/**
 * 働き方・価値観の優先順位セレクター。候補（約12項目）から重要な3つを、
 * クリックした順に優先順位付きで選択する。4つ目以降は3件のいずれかを
 * 解除するまで選択できない。選択順そのものが優先順位を表すため、
 * 送信するhidden inputの並び順が呼び出し元（DB保存）での配列順序になる。
 */
export function ValuePrioritySelector({ name, label, options, defaultValues = [], errors, onChange }: Props) {
  const [selected, setSelected] = useState<string[]>(defaultValues);

  function toggle(code: string) {
    const next = selected.includes(code)
      ? selected.filter((c) => c !== code)
      : selected.length >= 3
        ? selected
        : [...selected, code];

    if (next === selected) return; // 3件到達時に4件目を押した場合は何もしない

    setSelected(next);
    onChange?.(next);
  }

  return (
    <div>
      {label && <span className="mb-1.5 block text-[13px] font-medium text-charcoal">{label}</span>}
      <p className="mb-2 text-[12px] text-sub">重要だと思う順に3つ選んでください（{selected.length}/3選択中）</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const rank = selected.indexOf(opt.code);
          const isSelected = rank !== -1;
          const disabled = !isSelected && selected.length >= 3;
          return (
            <button
              key={opt.code}
              type="button"
              disabled={disabled}
              onClick={() => toggle(opt.code)}
              aria-pressed={isSelected}
              className={`rounded-full border px-4 py-2 text-[13px] transition-colors disabled:opacity-40 ${
                isSelected
                  ? "border-ink bg-ink text-surface"
                  : "border-line bg-surface text-charcoal"
              }`}
            >
              {isSelected && <span className="mr-1 font-bold">{rank + 1}</span>}
              {opt.label}
            </button>
          );
        })}
      </div>
      {selected.map((code) => (
        <input key={code} type="hidden" name={name} value={code} />
      ))}
      <FieldError messages={errors} />
    </div>
  );
}
