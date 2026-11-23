"use client";

import { useActionState } from "react";
import { setStaffPasswordAction, type PasswordState } from "./actions";

export function PasswordForm({ accepting }: { accepting: boolean }) {
  const [s, action, pending] = useActionState(setStaffPasswordAction, { error: null } as PasswordState);
  return (
    <form action={action} className="mt-6 grid gap-3">
      {s.error && <p role="alert" className="rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] text-charcoal">{s.error}</p>}
      <label className="grid gap-1 text-[13px] text-charcoal">新しいパスワード（8文字以上・英字と数字を含む）<input name="password" type="password" autoComplete="new-password" required className="min-h-[44px] rounded-xl border border-line px-3" /></label>
      <label className="grid gap-1 text-[13px] text-charcoal">新しいパスワード（確認用）<input name="confirmPassword" type="password" autoComplete="new-password" required className="min-h-[44px] rounded-xl border border-line px-3" /></label>
      {s.fieldError && <p role="alert" className="text-[12.5px] text-charcoal">{s.fieldError}</p>}
      <button type="submit" disabled={pending} className="min-h-[44px] rounded-full bg-charcoal px-6 text-[14px] font-semibold text-white disabled:opacity-50">{pending ? "処理中…" : accepting ? "パスワードを設定して招待を承諾する" : "パスワードを設定する"}</button>
    </form>
  );
}
