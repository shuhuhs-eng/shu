"use client";

import { useActionState } from "react";
import { consumeStaffLinkAction, type LinkState } from "./actions";

export function LinkForm({ tokenHash, type, label }: { tokenHash: string; type: string; label: string }) {
  const [state, action, pending] = useActionState(consumeStaffLinkAction, { error: null } as LinkState);
  return (
    <form action={action} className="mt-6 grid gap-3">
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      {state.error && <p role="alert" className="rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] text-charcoal">{state.error}</p>}
      <button type="submit" disabled={pending} className="min-h-[44px] rounded-full bg-charcoal px-6 text-[14px] font-semibold text-white disabled:opacity-50">{pending ? "確認中…" : label}</button>
    </form>
  );
}
