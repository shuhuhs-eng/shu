import type { HiringReasonCode, HiringStatus, InterviewType } from "@/lib/hiring/types";

export const HIRING_STATUS_LABELS: Record<string, string> = {
  contacting: "連絡調整中",
  interview_scheduled: "面談予定",
  interview_completed: "面談済み",
  selection: "選考中",
  offered: "内定",
  hired: "採用",
  declined: "辞退",
  rejected: "不採用",
};

export const HIRING_SOURCE_LABELS: Record<string, string> = {
  interest: "話を聞いてみたい",
  scout: "スカウトへの返信",
  salary_offer: "給与オファーへの回答",
};

export const INTERVIEW_TYPE_LABELS: Record<string, string> = {
  in_person: "対面",
  online: "オンライン",
  phone: "電話",
};

export const HIRING_REASON_LABELS: Record<string, string> = {
  skill_mismatch: "スキル・経験のミスマッチ",
  culture_mismatch: "雰囲気・価値観のミスマッチ",
  conditions_mismatch: "条件が合わない",
  timing: "入社時期が合わない",
  other_offer: "他社・他店で決定",
  position_filled: "募集枠が埋まった",
  other: "その他",
};

/** 店舗側の履歴イベント名。 */
export const HIRING_EVENT_LABELS: Record<string, string> = {
  candidate_added: "採用進捗に追加",
  interview_scheduled: "面談を設定",
  interview_rescheduled: "面談日時を変更",
  interview_cancelled: "面談を取り消し",
  status_changed: "ステータスを変更",
  hired: "採用を確定",
  declined: "辞退",
  rejected: "不採用",
  reopened: "選考を再開",
  internal_note_updated: "社内メモを更新",
};

/**
 * 店舗側で選べる遷移。0037のDB関数 hiring_transition_allowed と同じ表。
 * ★UIの表示候補を絞るためだけのヒント。許可の本体はDB側（RPC）で、
 * UIと食い違っても不正な遷移はDBが拒否する。
 */
const TRANSITIONS: Record<HiringStatus, readonly HiringStatus[]> = {
  contacting: ["interview_scheduled", "rejected", "declined"],
  interview_scheduled: ["interview_scheduled", "interview_completed", "contacting", "rejected", "declined"],
  interview_completed: ["interview_scheduled", "selection", "offered", "rejected", "declined"],
  selection: ["interview_scheduled", "offered", "rejected", "declined"],
  offered: ["selection", "hired", "rejected", "declined"],
  declined: ["contacting"],
  rejected: ["contacting"],
  hired: [],
};

function isHiringStatus(value: string): value is HiringStatus {
  return value in TRANSITIONS;
}

export function allowedNextStatuses(current: string): readonly HiringStatus[] {
  return isHiringStatus(current) ? TRANSITIONS[current] : [];
}

/** 面談の登録・日時変更ができる状態か（フォームの表示判定）。 */
export function canScheduleInterview(current: string): boolean {
  return allowedNextStatuses(current).includes("interview_scheduled");
}

/** status変更ボタンの表示名（遷移の意味が分かる言い方）。 */
export function statusActionLabel(from: string, to: HiringStatus): string {
  if ((from === "declined" || from === "rejected") && to === "contacting") return "選考を再開する";
  if (from === "interview_scheduled" && to === "contacting") return "面談を取り消して連絡調整中に戻す";
  if (to === "hired") return "採用を確定する";
  if (to === "declined") return "辞退として記録する";
  if (to === "rejected") return "不採用にする";
  return `${HIRING_STATUS_LABELS[to]}にする`;
}

export function isClosedStatus(status: string): boolean {
  return status === "hired" || status === "declined" || status === "rejected";
}

export function isInterviewType(value: string): value is InterviewType {
  return value === "online" || value === "in_person" || value === "phone";
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ISO日時 → 日本時間の入力値（date: YYYY-MM-DD / time: HH:mm）。サーバー/ブラウザのTZに依存しない。 */
export function toJstInputParts(iso: string): { date: string; time: string } {
  const shifted = new Date(new Date(iso).getTime() + JST_OFFSET_MS).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

/** 日本時間の日付・時刻 → ISO（UTC）。不正な入力はnull。 */
export function jstPartsToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00+09:00`);
  if (Number.isNaN(d.getTime())) return null;
  // 2/30のような存在しない日付は丸められるので、往復して一致するか確認する。
  const back = toJstInputParts(d.toISOString());
  if (back.date !== date || back.time !== time) return null;
  return d.toISOString();
}

export function formatJstDateTimeWithWeekday(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 場所/URLがhttp(s)のURLならリンクにしてよい（それ以外のスキームはリンク化しない）。 */
export function asSafeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function isHiringReasonCode(value: string): value is HiringReasonCode {
  return value in HIRING_REASON_LABELS;
}
