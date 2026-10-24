"use client";

import { useState } from "react";
import { acceptLegalDocumentsAction } from "@/lib/legal/actions";

/** 規約・プライバシーポリシーへの同意。チェックを入れないと進めない。 */
export function AcceptForm({ next, labels }: { next: string; labels: string[] }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!checked || busy) return;
    setBusy(true);
    setError(null);
    // 成功すると、サーバー側でリダイレクトされる（戻ってくるのは失敗のときだけ）。
    const result = await acceptLegalDocumentsAction(next);
    setBusy(false);
    if (result && !result.success) setError(result.error);
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-4">
      <label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-charcoal">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} disabled={busy} className="mt-1 h-4 w-4" />
        <span>{labels.join("と")}の内容を確認し、同意します。</span>
      </label>
      <button type="submit" disabled={!checked || busy}
        className="flex w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface disabled:opacity-40">
        {busy ? "記録しています…" : "同意して続ける"}
      </button>
      {error && <p className="rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">{error}</p>}
    </form>
  );
}
