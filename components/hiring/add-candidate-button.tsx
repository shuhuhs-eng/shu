"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addHiringCandidateAction } from "@/lib/hiring/actions";
import { RECRUITING_PAUSED_MESSAGE } from "@/lib/contracts/recruiting-access";

type Props = {
  storeId: string;
  stylistUserId: string;
  /** すでに採用進捗にある場合のprocess id（あれば詳細へのリンクを出す）。 */
  processId: string | null;
  /** 書き込み権限の表示ヒント（権限の本体はDB）。falseならボタンは出さない。 */
  canManage: boolean;
  /** 新しい採用活動を受け付けていない店舗か（新規の候補者追加を止める。既存の採用進捗リンクは出す）。 */
  recruitingPaused?: boolean;
};

/**
 * 「採用進捗に追加」ボタン（Interest / Scout / Offer 画面用）。
 * 登録済みなら詳細リンク、未登録かつ書き込み権限があればボタンを表示する。
 * 追加できる条件（接点の有無・起点の決定）はDB側(add_hiring_candidate)で検証される。
 */
export function AddCandidateButton({ storeId, stylistUserId, processId, canManage, recruitingPaused = false }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (processId) {
    return (
      <Link
        href={`/salon/stores/${storeId}/candidates/${processId}`}
        className="mt-3 inline-block text-[12px] font-semibold text-sub underline"
      >
        採用進捗を見る ›
      </Link>
    );
  }
  if (!canManage) return null;
  if (recruitingPaused) {
    return <p className="mt-3 text-[11px] leading-relaxed text-sub">{RECRUITING_PAUSED_MESSAGE}。新しく採用進捗に追加することはできません。</p>;
  }

  async function add() {
    setBusy(true);
    setMessage(null);
    const result = await addHiringCandidateAction(storeId, stylistUserId);
    setBusy(false);
    if (!result.success) {
      setMessage(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={add}
        disabled={busy}
        className="w-full rounded-full border border-ink bg-surface px-4 py-3 text-[12px] font-bold text-ink disabled:opacity-50"
      >
        {busy ? "追加しています…" : "採用進捗に追加"}
      </button>
      {message && <p className="mt-2 text-[11px] text-[#8A2E2E]">{message}</p>}
    </div>
  );
}
