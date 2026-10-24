"use client";

import { StatusPanel } from "@/components/error-panel";

/** 想定外のエラー時の共通画面。エラー本文・スタックは表示しない（digest のみサポート用に表示）。 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StatusPanel
      title="一時的に表示できません"
      action={
        <button type="button" onClick={reset} className="flex w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface">
          もう一度試す
        </button>
      }
    >
      <p>処理中に問題が発生しました。少し時間をおいて再度お試しください。解決しない場合は運営までお問い合わせください。</p>
      {error.digest && <p className="mt-2 text-[11px] text-sub">エラーコード: {error.digest}</p>}
    </StatusPanel>
  );
}
