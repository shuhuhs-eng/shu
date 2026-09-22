type Props = {
  leftLabel: string;
  rightLabel: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
};

/**
 * 方向性型CultureAxis用のスライダー。docs/salon-culture-input-ux.md の指示どおり、
 * 両端のラベルはどちらかが優れて見える表現を避け、中立的な言い回しにする
 * （呼び出し側でラベル文言を決める。このコンポーネント自体は左右の位置のみを扱う）。
 */
export function CultureSlider({ leftLabel, rightLabel, value, onChange, disabled }: Props) {
  return (
    <div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        disabled={disabled}
        onChange={(e: { target: { value: string } }) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--gold)]"
      />
      <div className="mt-2 flex items-center justify-between text-[12px] text-sub">
        <span className="max-w-[45%]">{leftLabel}</span>
        <span className="max-w-[45%] text-right">{rightLabel}</span>
      </div>
      <p className="mt-2 text-center text-[11.5px] text-sub">
        どちらも良し悪しではなく、サロンの個性です
      </p>
    </div>
  );
}
