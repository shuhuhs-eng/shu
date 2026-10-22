import Link from "next/link";
import {
  INTERVIEW_TYPE_LABELS,
  asSafeHttpUrl,
  formatJstDateTimeWithWeekday,
  isClosedStatus,
} from "@/lib/hiring/format";
import { formatJstDateTime } from "@/lib/store-activity/format";
import type { MyHiringProcess, MyHiringProcessEvent } from "@/lib/hiring/types";
import { HiringStatusBadge } from "@/components/hiring/status-badge";
import { DeclineHiringButton } from "@/components/hiring/decline-button";

/** 美容師向けの履歴の言い方（店舗側の内部用語を出さない）。 */
function stylistEventLabel(e: MyHiringProcessEvent): string {
  switch (e.event_type) {
    case "candidate_added":
      return "店舗が選考を開始しました";
    case "interview_scheduled":
      return "面談が設定されました";
    case "interview_rescheduled":
      return "面談の日時が変更されました";
    case "interview_cancelled":
      return "面談が取り消されました";
    case "hired":
      return "採用が決定しました";
    case "declined":
      return e.actor_kind === "stylist" ? "あなたが辞退しました" : "店舗側で辞退扱いとなりました";
    case "rejected":
      return "今回はお見送りとなりました";
    case "reopened":
      return "選考が再開されました";
    case "status_changed":
      return "選考が進みました";
    default:
      return "更新されました";
  }
}

const STATUS_NOTE: Record<string, string> = {
  contacting: "店舗から面談の日程などの連絡がある予定です。",
  interview_scheduled: "面談の日程が決まっています。内容をご確認ください。",
  interview_completed: "面談は完了しています。店舗からの連絡をお待ちください。",
  selection: "店舗で選考を進めています。",
  offered: "店舗から内定が出ています。詳細は店舗からの連絡をご確認ください。",
};

/**
 * 美容師向けの選考カード。表示してよいのはRPC(get_my_hiring_processes)が返す
 * 項目のみ。社内メモ・理由・スタッフのIDは、そもそもデータに含まれない。
 */
export function StylistApplicationCard({ process: p }: { process: MyHiringProcess }) {
  const area = [p.prefecture, p.city].filter(Boolean).join(" ");
  const interviewUrl = p.interview_type === "online" ? asSafeHttpUrl(p.interview_location) : null;
  const closed = isClosedStatus(p.status);

  return (
    <article className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-[16px] font-bold text-ink">{p.store_name}</h3>
          {area && <p className="mt-1 text-[12px] text-sub">{area}</p>}
        </div>
        <HiringStatusBadge status={p.status} />
      </div>

      {p.status === "hired" ? (
        <p className="mt-3 rounded-lg bg-[#37755B]/10 px-3 py-2 text-[12px] font-semibold text-[#285B45]">
          採用が決定しました{p.hired_at ? `（${formatJstDateTime(p.hired_at)}）` : ""}
        </p>
      ) : p.status === "declined" ? (
        <p className="mt-3 rounded-lg bg-surface2 px-3 py-2 text-[12px] text-charcoal">
          {p.declined_by === "stylist" ? "あなたが辞退しました。" : "店舗側で辞退扱いとなりました。"}
        </p>
      ) : p.status === "rejected" ? (
        <p className="mt-3 rounded-lg bg-surface2 px-3 py-2 text-[12px] text-charcoal">
          今回はお見送りとなりました。
        </p>
      ) : (
        STATUS_NOTE[p.status] && <p className="mt-3 text-[12px] text-charcoal">{STATUS_NOTE[p.status]}</p>
      )}

      {p.interview_at && (
        <div className="mt-3 rounded-lg border border-line bg-surface2 p-3">
          <p className="text-[10px] font-semibold text-sub">面談</p>
          <p className="mt-1 text-[13px] font-bold text-ink">{formatJstDateTimeWithWeekday(p.interview_at)}</p>
          <p className="mt-1 text-[12px] text-charcoal">
            {p.interview_type ? INTERVIEW_TYPE_LABELS[p.interview_type] ?? p.interview_type : ""}
          </p>
          {p.interview_location && (
            <p className="mt-1 break-all text-[12px] text-charcoal">
              {interviewUrl ? (
                <a href={interviewUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {p.interview_location}
                </a>
              ) : (
                p.interview_location
              )}
            </p>
          )}
        </div>
      )}

      {p.candidate_message && (
        <div className="mt-3 rounded-lg border border-line bg-surface2 p-3">
          <p className="text-[10px] font-semibold text-sub">店舗からの案内</p>
          <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-charcoal">{p.candidate_message}</p>
        </div>
      )}

      {p.events.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-semibold text-sub">これまでの流れ</p>
          <ol className="mt-2 space-y-1.5">
            {[...p.events].reverse().map((e, index) => (
              <li key={`${e.created_at}-${index}`} className="text-[11.5px] text-charcoal">
                <span className="text-sub">{formatJstDateTime(e.created_at)}</span>　{stylistEventLabel(e)}
                {e.interview_at && (
                  <span className="text-sub">（面談 {formatJstDateTimeWithWeekday(e.interview_at)}）</span>
                )}
                {e.public_note && (
                  <span className="mt-0.5 block whitespace-pre-line pl-3 text-sub">{e.public_note}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {p.store_is_public && (
        <Link
          href={`/stylist/salons/${p.store_id}`}
          className="mt-4 inline-block text-[12px] font-semibold text-sub underline"
        >
          店舗の詳細を見る ›
        </Link>
      )}

      {!closed && <DeclineHiringButton processId={p.process_id} storeName={p.store_name} />}
    </article>
  );
}
