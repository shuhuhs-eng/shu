"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/notifications/actions";
import type { Database } from "@/types/database";

type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

const TYPE_LABELS: Record<string, string> = {
  scout_received: "スカウト",
  scout_responded: "スカウトへの反応",
  salary_offer_received: "給与オファー",
  salary_offer_revised: "給与オファー再提示",
  salary_offer_accepted: "承諾",
  salary_offer_revision_requested: "条件相談",
  salary_offer_declined: "辞退",
  evidence_verified: "実績確認",
  evidence_rejected: "実績確認",
  interview_action_required: "次のアクション",
  stylist_interest_received: "意思表示",
};

// 通知typeごとの遷移先。既存ページのセクションに#idを追加しているだけで、
// 新しい画面は作っていない（stylist側の届いた給与条件＝#salary-offers、
// salon側の興味表明/給与オファーはどちらも同じ「興味を送ってくれた美容師」
// セクション内に表示されるため両方とも#interestsへ遷移する）。
function targetHref(notification: NotificationRow, role: "stylist" | "salon"): string {
  switch (notification.type) {
    case "salary_offer_received":
    case "salary_offer_revised":
      return "/stylist/mypage#salary-offers";
    case "salary_offer_accepted":
    case "salary_offer_revision_requested":
    case "salary_offer_declined":
    case "stylist_interest_received":
      return "/salon/mypage#interests";
    case "evidence_verified":
    case "evidence_rejected":
      return "/stylist/match-profile#evidence";
    case "scout_received":
    case "scout_responded":
    case "interview_action_required":
    default:
      return role === "stylist" ? "/stylist/mypage" : "/salon/mypage";
  }
}

export function NotificationBell({
  notifications,
  unreadCount,
  role,
}: {
  notifications: NotificationRow[];
  unreadCount: number;
  role: "stylist" | "salon";
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(notifications);
  const [unread, setUnread] = useState(unreadCount);
  const [busy, setBusy] = useState(false);

  async function handleOpenItem(notification: NotificationRow) {
    if (!notification.is_read) {
      setItems((current) => current.map((n) => (n.id === notification.id ? { ...n, is_read: true } : n)));
      setUnread((current) => Math.max(0, current - 1));
      await markNotificationRead({ notificationId: notification.id });
    }
    setOpen(false);
  }

  async function handleMarkAll() {
    setBusy(true);
    setItems((current) => current.map((n) => ({ ...n, is_read: true })));
    setUnread(0);
    await markAllNotificationsRead();
    setBusy(false);
  }

  return (
    <div className="relative">
      {/* ★未読の有無で視覚的な差を大きくする: 未読ありは赤地に白文字の
          目立つピル、未読0件は控えめなニュートラル表示にする。単なる
          小さいアイコンだけにせず「🔔 通知 3」の形でラベル+件数を出す。 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 rounded-full border px-4 py-2.5 text-[13px] font-bold transition-colors ${
          unread > 0 ? "border-[#C24545] bg-[#C24545] text-white" : "border-line bg-surface text-ink"
        }`}
        aria-label={unread > 0 ? `通知 未読${unread}件` : "通知"}
      >
        <Bell size={18} strokeWidth={2} />
        <span>通知</span>
        {unread > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[11px] font-extrabold text-[#C24545]">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 max-h-[420px] w-[300px] overflow-y-auto rounded-2xl border border-line bg-surface p-3 shadow-lg">
          <div className="flex items-center justify-between gap-2 px-1">
            <p className="text-[12px] font-bold text-ink">通知</p>
            {unread > 0 && (
              <button type="button" disabled={busy} onClick={handleMarkAll} className="text-[11px] text-sub underline disabled:opacity-50">
                すべて既読にする
              </button>
            )}
          </div>
          {items.length === 0 && <p className="mt-4 px-1 text-[12px] text-sub">通知はまだありません。</p>}
          <div className="mt-2 space-y-1.5">
            {items.map((notification) => (
              <Link
                key={notification.id}
                href={targetHref(notification, role)}
                onClick={() => handleOpenItem(notification)}
                className={`block rounded-xl border px-3 py-2.5 text-left ${
                  notification.is_read ? "border-line bg-surface" : "border-[#9A7B41]/40 bg-[#9A7B41]/5"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11.5px] font-bold text-ink">{notification.title}</p>
                  {!notification.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-[#C24545]" />}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-charcoal">{notification.message}</p>
                <p className="mt-1 text-[10px] text-sub">
                  {new Date(notification.created_at).toLocaleString("ja-JP")} ・ {TYPE_LABELS[notification.type] ?? notification.type} ・{" "}
                  {notification.is_read ? "既読" : "未読"}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
