"use client";

import { useState, useTransition } from "react";
import { retryAllUnissuedSubscriptionInvoicesAction, retrySubscriptionInvoiceAction } from "@/lib/invoices/subscription-actions";
import type { InvoiceActionResult } from "@/lib/invoices/types";

function Result({ r }: { r: InvoiceActionResult | null }) {
  if (!r) return null;
  return (
    <div role={r.success ? "status" : "alert"} className={`mt-1 text-[11.5px] ${r.success ? "text-[#285B45]" : "text-[#8A2E2E]"}`}>
      <p>{r.success ? r.message : r.error}</p>
      {!r.success && r.missing && r.missing.length > 0 && <ul className="list-disc pl-4">{r.missing.map((m) => <li key={m}>{m}</li>)}</ul>}
    </div>
  );
}

/** 未発行の月額請求書PDFを（1件／まとめて）再試行する。支払記録は変わらない。 */
export function SubscriptionInvoiceRetry({ paymentId }: { paymentId?: string }) {
  const [res, setRes] = useState<InvoiceActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <button type="button" disabled={pending} className="rounded-full border border-line px-3 py-1 text-[11.5px] font-bold text-ink disabled:opacity-60"
        onClick={() => start(async () => setRes(paymentId ? await retrySubscriptionInvoiceAction(paymentId) : await retryAllUnissuedSubscriptionInvoicesAction()))}>
        {pending ? "処理中…" : paymentId ? "発行を再試行" : "未発行をまとめて再試行"}
      </button>
      <Result r={res} />
    </div>
  );
}
