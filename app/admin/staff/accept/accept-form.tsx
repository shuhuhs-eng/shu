"use client";

import { useActionState } from "react";
import { acceptStaffInvitationAction, type AcceptState } from "@/app/admin/staff/actions";

const initial: AcceptState = { error: null };

export function AcceptForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState(acceptStaffInvitationAction, initial);
  return (
    <form action={action} className="mt-6 grid gap-3">
      {state.error && <p role="alert" className="rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] text-charcoal">{state.error}</p>}
      <button type="submit" disabled={disabled || pending} className="min-h-[44px] rounded-full bg-charcoal px-6 text-[14px] font-semibold text-white disabled:opacity-50">
        {pending ? "処理中…" : "招待を承諾して運営を始める"}
      </button>
    </form>
  );
}
