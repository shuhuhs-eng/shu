"use client";

import { useState, useTransition } from "react";
import { resolveStripeIssueAction } from "@/lib/stripe/admin-actions";

/** Stripe不整合を「対応済み」にする。状態の自動修復はせず、対応内容の記録だけ行う。 */
export function StripeIssueResolve({ issueId }: { issueId: string }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="mt-2 flex flex-wrap items-start gap-2" onSubmit={(e) => {
      e.preventDefault(); setError(null);
      start(async () => {
        const r = await resolveStripeIssueAction({ issueId, note });
        if (!r.success) setError(r.error);
      });
    }}>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} required placeholder="対応内容（例：Stripeで返金済み）"
        className="min-w-[220px] flex-1 rounded-lg border border-line bg-white px-3 py-1.5 text-[12px]" aria-label="対応内容" />
      <button type="submit" disabled={pending || !note.trim()} className="rounded-full bg-ink px-4 py-1.5 text-[12px] font-bold text-white disabled:opacity-60">対応済みにする</button>
      {error && <p role="alert" className="w-full text-[11.5px] text-[#8A2E2E]">{error}</p>}
    </form>
  );
}
