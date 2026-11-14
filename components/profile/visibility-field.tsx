"use client";

import { useState } from "react";

type Props = {
  /** 画面で選ぶのは「公開」「非公開」の二択。既存の「一部公開」の値は、呼び出し側で「非公開」に寄せて渡す（サロンには元々見えていない値のため、見え方は変わらない）。 */
  defaultValue: "PUBLIC" | "PRIVATE";
  errors?: string[];
};

const OPTIONS = [
  { value: "PUBLIC", label: "公開", note: "サロンが、公開名・都道府県・経験・得意技術・自己紹介などを見て、スカウトを送れます。" },
  { value: "PRIVATE", label: "非公開", note: "サロンの一覧・検索には表示されません。スカウトも届きません。" },
] as const;

/**
 * プロフィールの公開範囲（公開／非公開の二択）。選択はこのコンポーネントの状態で保持し、保存後のフォーム再初期化で
 * 見た目だけ元の値に戻ることがないようにしている（保存される値と画面の選択が常に一致する）。
 * 氏名・性別・年代・氏名に当たる情報は、公開を選んでも公開されない。
 */
export function VisibilityField({ defaultValue, errors }: Props) {
  const [value, setValue] = useState<"PUBLIC" | "PRIVATE">(defaultValue);
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-semibold text-ink">プロフィールの公開範囲</legend>
      <div className="space-y-2">
        {OPTIONS.map((o) => {
          const checked = value === o.value;
          return (
            <label
              key={o.value}
              className={`flex min-h-[48px] cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 ${checked ? "border-ink bg-surface2" : "border-line bg-surface"}`}
            >
              <input type="radio" name="visibility" value={o.value} checked={checked} onChange={() => setValue(o.value)} className="mt-1 h-4 w-4 accent-[var(--ink,#222)]" />
              <span>
                <span className="block text-[14px] font-semibold text-ink">{o.label}</span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-sub">{o.note}</span>
              </span>
            </label>
          );
        })}
      </div>
      {errors && errors.length > 0 && <p className="mt-1 text-[12px] text-[#C24545]">{errors[0]}</p>}
    </fieldset>
  );
}
