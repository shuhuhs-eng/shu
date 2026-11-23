"use client";

import { useRef, useState } from "react";
import { markNotificationsReadForEntities } from "@/lib/notifications/actions";
import { badgeOutcome, markEntitiesReadInChunks, type NotificationEntity } from "@/lib/notifications/entity-chunks";

/**
 * 「このサロン／この美容師に関する未読がある」ことを示すバッジ。
 * クリックすると、渡されたentities(type+idの組)に一致する未読通知だけを
 * 既読化する。全体既読(NotificationBellの「すべて既読にする」)とは別経路で、
 * 他のカードの未読には一切影響しない。
 *
 * サーバーは1回200件までなので、200件以下に分割して順に送る（切り捨てない）。
 * ★全回が成功したときだけバッジを消す。途中で失敗・通信例外があれば消さず、
 *  「既読にできませんでした。もう一度押してください」と表示し、未処理の分だけを再送できる。
 */
export function CardNotificationBadge({
  count: initialCount,
  entities,
}: {
  count: number;
  entities: { type: string; id: string }[];
}) {
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const remaining = useRef<NotificationEntity[] | null>(null); // 前回失敗時の未処理分（再試行はここだけ送る）

  if (count === 0) return null;

  async function handleClick() {
    const target = remaining.current ?? entities;
    if (busy || target.length === 0) return;
    setBusy(true);
    setFailed(false);
    const out = badgeOutcome(await markEntitiesReadInChunks(target, markNotificationsReadForEntities));
    remaining.current = out.remaining;
    if (out.clear) setCount(0);
    setFailed(out.showRetry);
    setBusy(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#C24545] px-2.5 py-1 text-[10.5px] font-bold text-white disabled:opacity-60"
      >
        🔔 未読{count}件
      </button>
      {failed && (
        <span role="alert" className="text-[10.5px] font-bold text-[#C24545]">
          既読にできませんでした。もう一度押してください
        </span>
      )}
    </>
  );
}
