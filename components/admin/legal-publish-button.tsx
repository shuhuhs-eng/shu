"use client";

import { useState } from "react";
import { publishLegalDocumentAction } from "@/lib/legal/actions";

/** コードの本文を公開版として登録する（施行日を指定）。公開後は変更できない。 */
export function LegalPublishButton({ type, label, defaultDate, disabled = false }: { type: "terms" | "privacy"; label: string; defaultDate: string; disabled?: boolean }) {
  const [date, setDate] = useState(defaultDate);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function publish() {
    if (busy) return;
    if (!window.confirm(`${label}を、施行日 ${date} で公開します。\n公開時の本文（運営者情報・施行日を含む）がそのまま保存され、変更・削除できません。施行日以降、ユーザーに同意を求めます。よろしいですか？`)) return;
    setBusy(true);
    const result = await publishLegalDocumentAction({ type, effectiveDate: date });
    setBusy(false);
    setMessage(result.success ? result.message : result.error);
  }

  return (
    <div className="mt-3 space-y-2">
      <label className="block text-[11px] text-sub">施行日
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy}
          className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-ink" />
      </label>
      <button type="button" onClick={publish} disabled={busy || !date || disabled}
        className="rounded-full bg-[#285B45] px-4 py-2 text-[12px] font-bold text-white disabled:opacity-50">この版を公開する</button>
      {message && <p className="text-[12px] text-charcoal">{message}</p>}
    </div>
  );
}
