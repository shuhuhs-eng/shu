"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateHiringInternalNoteAction } from "@/lib/hiring/actions";

type Props = {
  storeId: string;
  processId: string;
  initialNote: string | null;
  /** falseなら閲覧のみ（viewer）。 */
  canManage: boolean;
};

/** 社内メモ（美容師には表示されない）。書き込み権限が無い場合は読み取り表示のみ。 */
export function InternalNoteForm({ storeId, processId, initialNote, canManage }: Props) {
  const router = useRouter();
  const [note, setNote] = useState(initialNote ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!canManage) {
    return (
      <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-charcoal">
        {initialNote ?? "社内メモはありません"}
      </p>
    );
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    const result = await updateHiringInternalNoteAction({ storeId, processId, note });
    setBusy(false);
    if (!result.success) {
      setMessage(result.error);
      return;
    }
    setMessage("保存しました");
    router.refresh();
  }

  return (
    <div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={2000}
        className="min-h-24 w-full rounded-lg border border-line px-3 py-2 text-[12.5px]"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-full bg-ink px-5 py-2.5 text-[12px] font-bold text-surface disabled:opacity-50"
        >
          {busy ? "保存しています…" : "社内メモを保存"}
        </button>
        {message && <span className="text-[11px] text-sub">{message}</span>}
      </div>
    </div>
  );
}
