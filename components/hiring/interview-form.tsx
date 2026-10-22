"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { scheduleHiringInterviewAction } from "@/lib/hiring/actions";
import { INTERVIEW_TYPE_LABELS, toJstInputParts } from "@/lib/hiring/format";

type Props = {
  storeId: string;
  processId: string;
  /** 既存の面談があれば初期値にする（日時変更も同じフォーム）。 */
  current: {
    interviewAt: string | null;
    interviewType: string | null;
    location: string | null;
    candidateMessage: string | null;
  };
};

/** 面談の登録・日時変更フォーム（日本時間で入力）。 */
export function InterviewForm({ storeId, processId, current }: Props) {
  const router = useRouter();
  const initial = current.interviewAt ? toJstInputParts(current.interviewAt) : { date: "", time: "" };
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [type, setType] = useState(current.interviewType ?? "in_person");
  const [location, setLocation] = useState(current.location ?? "");
  const [message, setMessage] = useState(current.candidateMessage ?? "");
  const [internal, setInternal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isChange = current.interviewAt != null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-full bg-ink px-4 py-3 text-[12px] font-bold text-surface"
      >
        {isChange ? "面談日時を変更する" : "面談を設定する"}
      </button>
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await scheduleHiringInterviewAction({
      storeId,
      processId,
      date,
      time,
      interviewType: type,
      location,
      candidateMessage: message,
      internalNote: internal,
    });
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setInternal("");
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-[12px] font-bold text-ink">{isChange ? "面談日時を変更" : "面談を設定"}</p>
      <p className="mt-1 text-[10.5px] text-sub">日時は日本時間で入力します。保存すると美容師にも表示されます。</p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block text-[11px] text-charcoal">
          日付
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2"
          />
        </label>
        <label className="block text-[11px] text-charcoal">
          時刻
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2"
          />
        </label>
      </div>

      <label className="mt-3 block text-[11px] text-charcoal">
        面談形式
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line px-3 py-2"
        >
          {Object.entries(INTERVIEW_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-3 block text-[11px] text-charcoal">
        場所 / URL
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          maxLength={500}
          placeholder="例：店舗の住所、またはオンライン面談のURL"
          className="mt-1 w-full rounded-lg border border-line px-3 py-2"
        />
      </label>

      <label className="mt-3 block text-[11px] text-charcoal">
        美容師への案内（美容師に表示されます）
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={1000}
          placeholder="例：当日は動きやすい服装でお越しください。"
          className="mt-1 min-h-16 w-full rounded-lg border border-line px-3 py-2 text-[12px]"
        />
      </label>

      <label className="mt-3 block text-[11px] text-charcoal">
        社内メモ（美容師には表示されません）
        <textarea
          value={internal}
          onChange={(e) => setInternal(e.target.value)}
          maxLength={2000}
          className="mt-1 min-h-16 w-full rounded-lg border border-line px-3 py-2 text-[12px]"
        />
      </label>

      {error && <p className="mt-3 text-[11px] text-[#8A2E2E]">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !date || !time}
          className="flex-1 rounded-full bg-ink px-4 py-3 text-[12px] font-bold text-surface disabled:opacity-50"
        >
          {busy ? "保存しています…" : "保存する"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="rounded-full border border-line px-4 py-3 text-[12px] text-sub"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
