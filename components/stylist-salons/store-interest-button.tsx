"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OwnInterestState } from "@/lib/interests/load";
import { setStoreInterestAction } from "@/lib/interests/actions";
import {
  INTEREST_KINDS,
  INTEREST_KIND_CANCEL_LABELS,
  INTEREST_KIND_LABELS,
  type InterestKind,
} from "@/lib/interests/kinds";

type Props = {
  storeId: string;
  /** 希望状態（取得できなかったときは unknown。未送信と見せず、送信・取消を止める）。 */
  interestState: OwnInterestState;
};

/**
 * 店舗単位の希望ボタン（美容師側・店舗詳細）。「見学を希望する」「体験入店を希望する」の2つ。
 * 種別ごとに送信済み表示・取消ができ、片方の取消はもう片方に影響しない。
 * 失敗時は生のエラーを出さず、決まった文言のみ表示する。
 */
export function StoreInterestButton({ storeId, interestState }: Props) {
  const router = useRouter();
  const unknown = interestState.status === "unknown";
  const fromProps = (st: OwnInterestState): Record<InterestKind, boolean> => ({
    visit: st.status === "known" ? st.kinds.visit : false,
    trial: st.status === "known" ? st.kinds.trial : false,
  });
  // サーバーから渡された希望状態が更新されたとき（再読み込み・router.refresh・取得失敗→再取得成功）は、
  // 画面の状態を最新の値へ同期する（props変化時にだけ置き換える派生state。操作直後のローカル更新はそのまま保つ）。
  const propKey = interestState.status === "known" ? `k:${interestState.kinds.visit ? 1 : 0}${interestState.kinds.trial ? 1 : 0}` : "unknown";
  const [seenKey, setSeenKey] = useState(propKey);
  const [state, setState] = useState<Record<InterestKind, boolean>>(fromProps(interestState));
  if (seenKey !== propKey) {
    setSeenKey(propKey);
    setState(fromProps(interestState));
  }
  const [error, setError] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<InterestKind | null>(null);
  const [pending, startTransition] = useTransition();

  function send(kind: InterestKind) {
    if (unknown || state[kind]) return; // 送信済みの主ボタンからは何もしない
    run(kind, true);
  }
  function cancel(kind: InterestKind) {
    if (unknown || !state[kind]) return; // 取消は明示した取消ボタンからだけ
    run(kind, false);
  }

  function run(kind: InterestKind, next: boolean) {
    setError(null);
    setPendingKind(kind);
    startTransition(async () => {
      const result = await setStoreInterestAction(storeId, kind, next);
      if (result.success) {
        setState((s) => ({ ...s, [kind]: next }));
      } else {
        setError(result.error);
      }
      setPendingKind(null);
    });
  }

  return (
    <div className="mt-3 space-y-2.5">
      {INTEREST_KINDS.map((kind) => {
        const on = state[kind];
        return (
          <div key={kind}>
            <button
              type="button"
              onClick={() => send(kind)}
              disabled={pending || unknown || on}
              aria-pressed={on}
              data-kind={kind}
              data-role="send"
              className={
                on
                  ? "w-full rounded-full border border-ink bg-surface px-5 py-3.5 text-[14px] font-semibold text-ink disabled:opacity-80"
                  : "w-full rounded-full bg-ink px-5 py-3.5 text-[14px] font-semibold text-surface disabled:opacity-60"
              }
            >
              {pending && pendingKind === kind
                ? "処理中..."
                : unknown
                  ? "送信状況を確認できません"
                  : on
                  ? `${INTEREST_KIND_LABELS[kind]}を送信済み`
                  : INTEREST_KIND_LABELS[kind]}
            </button>
            {on && (
              <button
                type="button"
                onClick={() => cancel(kind)}
                disabled={pending || unknown}
                data-kind={kind}
                data-role="cancel"
                className="mt-1 w-full text-center text-[12px] text-sub underline disabled:opacity-60"
              >
                {INTEREST_KIND_CANCEL_LABELS[kind]}
              </button>
            )}
          </div>
        );
      })}
      {unknown && (
        <p role="alert" data-testid="interest-unknown" className="text-center text-[12px] leading-relaxed text-[#8A2E2E]">
          送信状況を確認できませんでした。送信・取り消しはできません。時間をおいて、状況を再取得してください。
          <button type="button" data-role="retry" onClick={() => router.refresh()} className="ml-2 underline">状況を再取得する</button>
        </p>
      )}
      <p className="text-center text-[11px] leading-relaxed text-sub">
        送信すると公開プロフィールがこの店舗に共有されます。見学と体験入店は別々に送信・取り消しできます。
      </p>
      {error && (
        <p role="alert" className="text-center text-[12px] text-[#8A2E2E]">
          {error}
        </p>
      )}
    </div>
  );
}
