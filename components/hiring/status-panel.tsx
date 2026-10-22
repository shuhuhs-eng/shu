"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateHiringStatusAction } from "@/lib/hiring/actions";
import {
  HIRING_REASON_LABELS,
  HIRING_STATUS_LABELS,
  allowedNextStatuses,
  isHiringReasonCode,
  statusActionLabel,
} from "@/lib/hiring/format";
import type { HiringReasonCode, HiringStatus } from "@/lib/hiring/types";

type Props = {
  storeId: string;
  processId: string;
  currentStatus: string;
};

type TargetStatus = Exclude<HiringStatus, "interview_scheduled">;

/**
 * ステータス変更パネル。現在の状態から移動できる候補だけを表示する
 * （面談予定への変更は日時が要るため、面談フォーム側で行う）。
 * 採用確定(hired)後は候補が空になり、何も表示しない。
 */
export function StatusPanel({ storeId, processId, currentStatus }: Props) {
  const router = useRouter();
  const targets = allowedNextStatuses(currentStatus).filter(
    (s): s is TargetStatus => s !== "interview_scheduled",
  );
  const [selected, setSelected] = useState<TargetStatus | null>(null);
  const [publicNote, setPublicNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [reasonCode, setReasonCode] = useState<HiringReasonCode | "">("");
  const [reasonNote, setReasonNote] = useState("");
  const [confirmHired, setConfirmHired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (targets.length === 0) return null;

  const needsReason = selected === "declined" || selected === "rejected";

  function reset() {
    setSelected(null);
    setPublicNote("");
    setInternalNote("");
    setReasonCode("");
    setReasonNote("");
    setConfirmHired(false);
    setError(null);
  }

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const result = await updateHiringStatusAction({
      storeId,
      processId,
      toStatus: selected,
      publicNote,
      internalNote,
      reasonCode: needsReason ? reasonCode : "",
      reasonNote: needsReason ? reasonNote : "",
    });
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    reset();
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-[12px] font-bold text-ink">ステータスを変更</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {targets.map((target) => (
          <button
            key={target}
            type="button"
            onClick={() => {
              reset();
              setSelected(target);
            }}
            className={`rounded-full border px-3 py-2 text-[11.5px] font-semibold ${
              selected === target ? "border-ink bg-ink text-surface" : "border-line bg-surface text-charcoal"
            }`}
          >
            {statusActionLabel(currentStatus, target)}
          </button>
        ))}
      </div>

      {selected && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-[12px] text-charcoal">
            「{HIRING_STATUS_LABELS[selected]}」に変更します。
          </p>

          {selected === "hired" && (
            <label className="mt-3 flex items-start gap-2 rounded-lg bg-[#C24545]/10 p-3 text-[11px] leading-relaxed text-[#8A2E2E]">
              <input
                type="checkbox"
                checked={confirmHired}
                onChange={(e) => setConfirmHired(e.target.checked)}
                className="mt-0.5"
              />
              <span>採用を確定すると、あとから元に戻したり確定日時を変更したりできません。よろしいですか？</span>
            </label>
          )}

          {needsReason && (
            <>
              <label className="mt-3 block text-[11px] text-charcoal">
                理由（社内の記録用・美容師には表示されません）
                <select
                  value={reasonCode}
                  onChange={(e) => setReasonCode(isHiringReasonCode(e.target.value) ? e.target.value : "")}
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2"
                >
                  <option value="">選択しない</option>
                  {Object.entries(HIRING_REASON_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-3 block text-[11px] text-charcoal">
                理由のメモ（社内のみ）
                <textarea
                  value={reasonNote}
                  onChange={(e) => setReasonNote(e.target.value)}
                  maxLength={1000}
                  className="mt-1 min-h-14 w-full rounded-lg border border-line px-3 py-2 text-[12px]"
                />
              </label>
            </>
          )}

          <label className="mt-3 block text-[11px] text-charcoal">
            美容師への案内（任意・美容師に表示されます）
            <textarea
              value={publicNote}
              onChange={(e) => setPublicNote(e.target.value)}
              maxLength={1000}
              className="mt-1 min-h-14 w-full rounded-lg border border-line px-3 py-2 text-[12px]"
            />
          </label>
          <label className="mt-3 block text-[11px] text-charcoal">
            社内メモ（任意・美容師には表示されません）
            <textarea
              value={internalNote}
              onChange={(e) => setInternalNote(e.target.value)}
              maxLength={2000}
              className="mt-1 min-h-14 w-full rounded-lg border border-line px-3 py-2 text-[12px]"
            />
          </label>

          {error && <p className="mt-3 text-[11px] text-[#8A2E2E]">{error}</p>}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy || (selected === "hired" && !confirmHired)}
              className="flex-1 rounded-full bg-ink px-4 py-3 text-[12px] font-bold text-surface disabled:opacity-50"
            >
              {busy ? "保存しています…" : "変更する"}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="rounded-full border border-line px-4 py-3 text-[12px] text-sub"
            >
              やめる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
