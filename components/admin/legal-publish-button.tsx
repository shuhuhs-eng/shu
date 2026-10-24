"use client";

import { useState } from "react";
import { previewLegalPublishAction, publishLegalDocumentAction } from "@/lib/legal/actions";

/** コードの本文を公開版として登録する（施行日を指定）。公開後は変更できない。 */
export function LegalPublishButton({ type, defaultDate, disabled = false }: { type: "terms" | "privacy"; defaultDate: string; disabled?: boolean }) {
  const [date, setDate] = useState(defaultDate);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [preview, setPreview] = useState<{ title: string; version: string; effectiveDate: string; hash: string } | null>(null);

  async function openConfirm() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const result = await previewLegalPublishAction({ type, effectiveDate: date });
    setBusy(false);
    if (!result.success) {
      setMessage(result.error);
      return;
    }
    setPreview(result);
  }

  async function publish() {
    if (busy) return;
    setBusy(true);
    const result = await publishLegalDocumentAction({ type, effectiveDate: date });
    setBusy(false);
    setPreview(null);
    setMessage(result.success ? result.message : result.error);
  }

  return (
    <div className="mt-3 space-y-2">
      <label className="block text-[11px] text-sub">施行日
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy}
          className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-ink" />
      </label>
      <button type="button" onClick={openConfirm} disabled={busy || !date || disabled}
        className="rounded-full bg-[#285B45] px-4 py-2 text-[12px] font-bold text-white disabled:opacity-50">この版を公開する</button>
      {preview && (
        <div role="dialog" aria-modal="true" aria-label="公開の確認" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 px-5">
          <div className="w-full max-w-[460px] rounded-2xl bg-surface p-5 shadow-xl">
            <h3 className="font-serif text-[16px] font-bold text-ink">この内容で公開します</h3>
            <dl className="mt-3 space-y-1.5 text-[12.5px] text-charcoal">
              <div><dt className="inline text-sub">文書：</dt><dd className="inline">{preview.title}（{type === "terms" ? "terms" : "privacy"}）</dd></div>
              <div><dt className="inline text-sub">版：</dt><dd className="inline">{preview.version}</dd></div>
              <div><dt className="inline text-sub">施行日：</dt><dd className="inline">{preview.effectiveDate}</dd></div>
              <div><dt className="text-sub">本文のハッシュ（SHA-256）：</dt><dd className="break-all text-[11px]">{preview.hash}</dd></div>
            </dl>
            <p className="mt-3 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] font-semibold leading-relaxed text-[#8A2E2E]">
              公開後は変更・削除できません。施行日以降、全ユーザーに同意を求めます。法的な確認が済んだ正式版であることを確認してください。
            </p>
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={() => setPreview(null)} disabled={busy} className="flex-1 rounded-full border border-line px-4 py-2.5 text-[13px] text-ink">キャンセル</button>
              <button type="button" onClick={publish} disabled={busy} className="flex-1 rounded-full bg-[#285B45] px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-50">公開する</button>
            </div>
          </div>
        </div>
      )}
      {message && <p className="text-[12px] text-charcoal">{message}</p>}
    </div>
  );
}
