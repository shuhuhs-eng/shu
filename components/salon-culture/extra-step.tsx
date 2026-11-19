"use client";

import { ExtraQuestions } from "@/components/salon-culture/extra-questions";
import type { SupplementAnswers, SupplementKey, SupplementValue } from "@/lib/salon-culture/analysis/v1";

type Props = {
  values: Partial<SupplementAnswers>;
  onChange: (key: SupplementKey, v: SupplementValue) => void;
  disabled?: boolean;
  /** 公開中の追加5問がある（既存の回答を選択済みで表示している）。 */
  hasPublishedExtra: boolean;
  /** 一部だけ答えている。 */
  partial: boolean;
  /** 「今回の追加入力をクリアする」を出す（公開中の追加回答が無く、1問以上入力済みのとき）。 */
  canClear?: boolean;
  onClear?: () => void;
  /** 「ここまでを下書きに保存」（1〜4問の途中回答も保存する）。 */
  onSaveDraft?: () => void;
  note?: string | null;
};

/** 診断内容の更新フローの最後のステップ「追加の5問（任意）」。 */
export function ExtraStep({ values, onChange, disabled, hasPublishedExtra, partial, canClear, onClear, onSaveDraft, note }: Props) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-serif text-xl font-bold leading-snug text-ink">追加の5問（任意）</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-sub">
          {hasPublishedExtra
            ? "これまでの回答を選択済みで表示しています。変えない場合は、そのまま「確認する」へ進めます。"
            : "サロンらしさを5軸で見るための質問です。答えなくても、他の機能は今までどおり使えます。答えない場合は、何も選ばずに「確認する」へ進んでください。"}
        </p>
      </div>
      <ExtraQuestions values={values} onChange={onChange} disabled={disabled} />
      {partial && (
        <p role="alert" className="rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] leading-relaxed text-ink">
          追加の5問は、5問すべてに答えるか、すべて空のままにしてください。
        </p>
      )}
      {note && <p role="status" data-testid="extra-note" className="rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] leading-relaxed text-ink">{note}</p>}
      {(canClear || onSaveDraft) && (
        <div className="flex flex-col gap-2 sm:flex-row">
          {onSaveDraft && (
            <button type="button" onClick={onSaveDraft} disabled={disabled} data-testid="extra-save-draft"
              className="min-h-[44px] flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-[13px] font-semibold text-charcoal disabled:opacity-60">
              ここまでを下書きに保存
            </button>
          )}
          {canClear && onClear && (
            <button type="button" onClick={onClear} disabled={disabled} data-testid="extra-clear"
              className="min-h-[44px] flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-[13px] font-semibold text-charcoal disabled:opacity-60">
              今回の追加入力をクリアする
            </button>
          )}
        </div>
      )}
      {canClear && (
        <p className="text-[12px] leading-relaxed text-sub">
          クリアすると、この追加5問の入力だけが未回答に戻ります。基本12問・価値観・コメントは消えません。公開中の結果は変わりません。
        </p>
      )}
    </div>
  );
}
