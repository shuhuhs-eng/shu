"use client";

import { StatusPanel } from "@/components/error-panel";

/**
 * 管理画面（/admin 配下）の想定外エラー。戻り先は「管理画面」（/admin）。
 * ★権限確認はここでは変えない: /admin に戻っても、運営者でなければ /admin 側の確認で一般のマイページへ送られる。
 * 一般利用者向けの画面のエラー（app/error.tsx）は従来どおり「トップへ戻る」。
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StatusPanel
      title="一時的に表示できません"
      homeHref="/admin"
      homeLabel="管理画面へ戻る"
      action={
        <button type="button" onClick={reset} className="flex w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface">
          もう一度試す
        </button>
      }
    >
      <p>処理中に問題が発生しました。少し時間をおいて再度お試しください。解決しない場合は、エラーコードを控えてお知らせください。</p>
      {error.digest && <p className="mt-2 text-[11px] text-sub">エラーコード: {error.digest}</p>}
    </StatusPanel>
  );
}
