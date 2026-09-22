"use client";

import { useState } from "react";
import { markNotificationsReadForEntities } from "@/lib/notifications/actions";

/**
 * 「このサロン／この美容師に関する未読がある」ことを示すバッジ。
 * クリックすると、渡されたentities(type+idの組)に一致する未読通知だけを
 * 既読化する。全体既読(NotificationBellの「すべて既読にする」)とは別経路で、
 * 他のカードの未読には一切影響しない。
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

  if (count === 0) return null;

  async function handleClick() {
    if (busy || entities.length === 0) return;
    setBusy(true);
    setCount(0);
    await markNotificationsReadForEntities(entities);
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#C24545] px-2.5 py-1 text-[10.5px] font-bold text-white disabled:opacity-60"
    >
      🔔 未読{count}件
    </button>
  );
}
