import Link from "next/link";
import { Bell } from "lucide-react";

/** 未読件数の表示（99件を超えたら 99+）。 */
export function unreadBadgeText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** 読み上げ・ホバー用の名前。 */
export function homeBellLabel(unread: number | null): string {
  return unread && unread > 0 ? `通知 未読${unread}件` : "通知";
}

/**
 * トップ画面の右上に置く通知ベル（美容師・サロンのログイン中）。
 * 押すと、それぞれのマイページの既存の通知一覧（マイページ上部の通知ベル）を開いた状態で移動する。
 * 未読件数はマイページと同じ数え方で、未読があるときだけ赤いバッジを出す。取得できなかったとき(null)はバッジなし。
 */
export function HomeNotificationLink({ role, unread }: { role: "stylist" | "salon"; unread: number | null }) {
  const href = role === "stylist" ? "/stylist/mypage?notifications=open" : "/salon/mypage?notifications=open";
  const hasUnread = typeof unread === "number" && unread > 0;
  return (
    <Link
      href={href}
      aria-label={homeBellLabel(unread)}
      className={`relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border bg-surface text-ink ${
        hasUnread ? "border-[#C24545]" : "border-line"
      }`}
    >
      <Bell size={20} strokeWidth={2} aria-hidden="true" />
      {hasUnread && (
        <span
          data-testid="home-bell-badge"
          className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#C24545] px-1 text-[11px] font-extrabold leading-none text-white"
        >
          {unreadBadgeText(unread)}
        </span>
      )}
    </Link>
  );
}
