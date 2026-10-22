"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { declineHiringProcessAction } from "@/lib/hiring/actions";

/** 美容師本人が進行中の選考を辞退する（確認ステップ付き）。終了済みの選考では呼び出し側が表示しない。 */
export function DeclineHiringButton({ processId, storeName }: { processId: string; storeName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 w-full rounded-full border border-line bg-surface px-4 py-3 text-[12px] font-semibold text-sub"
      >
        この選考を辞退する
      </button>
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await declineHiringProcessAction(processId, note);
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-4 rounded-xl border border-line bg-surface2 p-4">
      <p className="text-[12px] font-bold text-ink">{storeName} の選考を辞退しますか？</p>
      <p className="mt-1 text-[10.5px] leading-relaxed text-sub">
        辞退すると店舗に伝わります。この操作は美容師側から取り消せません。
      </p>
      <label className="mt-3 block text-[11px] text-charcoal">
        店舗へのメッセージ（任意）
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          className="mt-1 min-h-16 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[12px]"
        />
      </label>
      {error && <p className="mt-2 text-[11px] text-[#8A2E2E]">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="flex-1 rounded-full bg-[#C24545] px-4 py-3 text-[12px] font-bold text-white disabled:opacity-50"
        >
          {busy ? "送信しています…" : "辞退する"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="rounded-full border border-line px-4 py-3 text-[12px] text-sub"
        >
          やめる
        </button>
      </div>
    </div>
  );
}
