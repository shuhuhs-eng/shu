type Option = { value: string; label: string };

type Props = {
  options: Option[];
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
};

/**
 * 4択（または任意数）の選択肢をカード状のボタンで表示する。
 * app/diagnosis/page.tsx の診断クイズと同じ操作感（タップで即選択）にする。
 */
export function ChoiceCards({ options, value, onChange, disabled }: Props) {
  return (
    <div className="space-y-3">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`w-full rounded-2xl border px-5 py-4 text-left text-[14.5px] leading-relaxed transition-colors disabled:opacity-60 ${
            value === opt.value
              ? "border-ink bg-ink text-surface"
              : "border-line bg-surface text-charcoal"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
