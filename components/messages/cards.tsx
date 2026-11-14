import Link from "next/link";
import { STATUS_LABEL } from "@/lib/messages/shared";
import type { AdminThreadRow, InboxRow } from "@/lib/messages/rpc";

export function AdminThreadCard({ t }: { t: AdminThreadRow }) {
  return (
    <Link href={`/admin/messages/${t.id}`} className="block rounded-2xl border border-line bg-surface p-4 hover:bg-surface2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
        <span className="rounded-full bg-ink px-2.5 py-0.5 text-white">{t.audience === "salon" ? "サロン宛" : "美容師宛"}</span>
        <span className="rounded-full border border-line px-2.5 py-0.5">{STATUS_LABEL[t.status] ?? t.status}</span>
        {t.recipient_access_lost && <span className="rounded-full bg-[#B8892E]/20 px-2.5 py-0.5 text-[#7A5A12]">宛先の担当者は権限なし</span>}
        {t.delivery_failed && <span className="rounded-full bg-[#C24545]/15 px-2.5 py-0.5 text-[#8A2E2E]">通知失敗</span>}
      </div>
      <p className="mt-2 break-words text-[14px] font-semibold text-ink">{t.subject}</p>
      <p className="mt-1 break-words text-[12px] text-sub">{[t.organization_name, t.store_name].filter(Boolean).join(" / ") || "（美容師宛）"}</p>
    </Link>
  );
}
export function InboxCard({ t }: { t: InboxRow }) {
  return (
    <Link href={`/messages/${t.id}`} className="block rounded-2xl border border-line bg-surface p-4 hover:bg-surface2">
      <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
        {t.needs_reply && <span className="rounded-full bg-ink px-2.5 py-0.5 text-white">返信をお願いします</span>}
        {t.closed && <span className="rounded-full border border-line px-2.5 py-0.5">完了</span>}
      </div>
      <p className="mt-2 break-words text-[14px] font-semibold text-ink">{t.subject}</p>
      {(t.organization_name || t.store_name) && <p className="mt-1 break-words text-[12px] text-sub">{[t.organization_name, t.store_name].filter(Boolean).join(" / ")}</p>}
    </Link>
  );
}
