"use client";

import { useState, useTransition } from "react";
import { setStoreInterestAction } from "@/lib/interests/actions";

type Props = {
  storeId: string;
  isInterested: boolean;
};

/**
 * 店舗単位「話を聞いてみたい」ボタン（美容師側・店舗詳細）。
 * set_store_interest のみを呼ぶ（storeIdはURL由来。salon_user_idは渡さない）。
 * 送信済みの場合は取り消し（interested=false）もできる。
 * 失敗時は生のエラーを出さず、決まった文言のみ表示する。
 */
export function StoreInterestButton({ storeId, isInterested }: Props) {
  const [interested, setInterested] = useState(isInterested);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !interested;
    setError(null);
    startTransition(async () => {
      const result = await setStoreInterestAction(storeId, next);
      if (result.success) {
        setInterested(next);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={interested}
        className="w-full rounded-full bg-ink px-5 py-3.5 text-[14px] font-semibold text-surface disabled:opacity-60"
      >
        {pending
          ? "送信中..."
          : interested
            ? "「話を聞いてみたい」を送信済み（取り消す）"
            : "話を聞いてみたい"}
      </button>
      <p className="mt-2 text-center text-[11px] leading-relaxed text-sub">
        {interested
          ? "あなたの公開プロフィールがこの店舗に届いています"
          : "送信すると公開プロフィールがこの店舗に共有されます"}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-center text-[12px] text-[#8A2E2E]">
          {error}
        </p>
      )}
    </div>
  );
}
