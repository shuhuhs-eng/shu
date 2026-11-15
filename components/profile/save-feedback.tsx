"use client";

import { useEffect, useRef } from "react";

/**
 * 保存ボタン直下に出す、保存結果の表示（成功・失敗）。
 * スクロールせずに、ボタンを押したその場で結果を確認できるようにする。
 * ・読み上げ: 成功は role="status"（aria-live=polite）、失敗は role="alert"（assertive）。
 *   どちらの領域も常に表示領域として存在させ、中身だけを切り替える（後から現れる領域は読み上げられないことがあるため）。
 * ・結果が出たとき、画面の外（ボタンが画面の下端にあるとき等）なら、最小限だけスクロールして見える位置に寄せる。
 * ・保存中は何も出さない（ボタンが「保存中…」になる）。成功は実際の保存成功後だけ。再編集を始めたら呼び出し側が消す。
 */
export function SaveFeedback({
  success,
  error,
}: {
  /** 表示する成功メッセージ。無ければ表示しない。 */
  success?: string;
  /** 表示するエラーメッセージ。無ければ表示しない。 */
  error?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = Boolean(success || error);
  useEffect(() => {
    if (shown) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [shown, success, error]);
  return (
    <div ref={ref} className="mt-3 space-y-2" data-testid="save-feedback">
      <div role="status" aria-live="polite" aria-atomic="true">
        {success ? (
          <p className="flex items-center justify-center gap-2 rounded-xl border border-[#2E8B7F]/30 bg-[#2E8B7F]/10 px-4 py-3 text-[14px] font-semibold text-[#1E5D53]">
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="10" cy="10" r="8.25" />
              <path d="M6.2 10.4l2.7 2.7 5-5.6" />
            </svg>
            <span>{success}</span>
          </p>
        ) : null}
      </div>
      <div role="alert" aria-atomic="true">
        {error ? (
          <p className="rounded-xl border border-[#C24545]/30 bg-[#C24545]/10 px-4 py-3 text-[13.5px] leading-relaxed text-[#8A2E2E]">{error}</p>
        ) : null}
      </div>
    </div>
  );
}
