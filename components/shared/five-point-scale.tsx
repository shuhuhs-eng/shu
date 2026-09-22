type Props = {
  leftLabel: string;
  rightLabel: string;
  value: number | undefined;
  onChange: (value: number) => void;
  disabled?: boolean;
  /**
   * ボタン群の下に表示する注記文。呼び出し側が用途に応じた文言を明示的に
   * 渡す（例: サロンらしさなら「サロンの特徴」、美容師Preferenceなら
   * 「働き方の好み」等）。省略時は何も表示しない。
   */
  note?: string;
};

/**
 * 5段階評価の共通UI（元々は components/salon-culture/five-point-scale.tsx として
 * サロンらしさ12問専用に実装されていたものを、美容師Preference8問でも同じ
 * 見た目・ロジックで使うため、components/shared/ へ安全に切り出した）。
 *
 * 1〜5をクリックで選択する。1が悪く5が良い、という意味ではなく、両端とも
 * 特徴を表すため、選択済みでも未選択でも同じトーン（ink色）で統一し、
 * 数字の大小によって色を変える（例: 5だけ目立つ色にする等）ことはしない。
 * 「良い・悪い」の印象を与えないことを最優先にしたデザイン。
 *
 * ★サロンらしさ側での見た目・挙動は、この切り出しによって一切変更していない
 * （className・DOM構造・ロジックはすべて元のファイルと同一。呼び出し側
 * salon-culture-wizard.tsx が渡すnoteの文言も元の固定文言と同じにしている
 * ため、レンダリング結果はbefore/afterで完全に同一）。
 */
export function FivePointScale({ leftLabel, rightLabel, value, onChange, disabled, note }: Props) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(n)}
            aria-pressed={value === n}
            aria-label={`${n}`}
            className={`flex h-12 w-12 items-center justify-center rounded-full border text-[16px] font-semibold transition-colors disabled:opacity-60 ${
              value === n ? "border-ink bg-ink text-surface" : "border-line bg-surface text-charcoal"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-start justify-between gap-3 text-[12px] leading-relaxed text-sub">
        <span className="max-w-[45%]">{leftLabel}</span>
        <span className="max-w-[45%] text-right">{rightLabel}</span>
      </div>
      {note && <p className="mt-3 text-center text-[11.5px] text-sub">{note}</p>}
    </div>
  );
}
