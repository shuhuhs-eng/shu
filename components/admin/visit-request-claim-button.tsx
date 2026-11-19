"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { claimVisitRequest } from "@/lib/admin/visit-requests-actions";

/** 受付（取り込み）。何度押しても1件。請求・通知は作らない。 */
export function VisitRequestClaimButton({ sourceKind, sourceId }: { sourceKind: "scout_reply" | "direct_interest"; sourceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function go() {
    if (busy) return;
    setBusy(true); setMsg(null);
    const r = await claimVisitRequest({ sourceKind, sourceId });
    setBusy(false);
    if (r.success && r.id) router.push(`/admin/visit-requests/${r.id}`);
    else if (!r.success) setMsg(r.error);
  }
  return (
    <span>
      <button type="button" disabled={busy} onClick={() => void go()} className="inline-flex min-h-[44px] items-center rounded-full bg-ink px-4 text-[12px] font-semibold text-white disabled:opacity-50">{busy ? "受付中..." : "受付する（担当になる）"}</button>
      {msg && <span className="ml-2 text-[11.5px] text-[#8A2E2E]">{msg}</span>}
    </span>
  );
}
