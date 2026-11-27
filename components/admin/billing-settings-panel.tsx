"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { decideHireRoleRule } from "@/lib/billing/hire-actions";

/** 責任者だけに表示する。採用料の登録区分ルールを決定済みにする（固定の1操作）。自動請求・カード必須化は変更しない。 */
export function HireRoleRuleDecision() {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [ok, setOk] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function run() {
    if (busy || !ok) return; setBusy(true); setMsg(null);
    try {
      const r = await decideHireRoleRule({ understood: ok });
      setMsg(r.success ? { ok: true, text: "決定を記録しました。変更履歴に残ります。自動請求・カード必須化は変更していません（OFFのままです。自動請求の有効化は、この画面にはない別の操作です）。" } : { ok: false, text: r.error });
      if (r.success) router.refresh();
    } catch { setMsg({ ok: false, text: "通信に失敗しました。結果が不明です。画面を読み込み直して状態を確認してください（確認なしに再操作しないでください）。" }); }
    finally { setBusy(false); }
  }
  return (
    <div className="mt-3 rounded-xl bg-surface2 p-3">
      <p className="text-[12.5px] font-semibold">採用料の登録区分ルールを「決定済み」にする（責任者のみ）</p>
      <p className="mt-1 text-[12px] text-sub">内容: 採用料の区分は、運営が本人に確認した登録区分（スタイリスト550,000円／アシスタント450,000円・税抜）で決めます。入社先で担当する業務では決めません（2026-11-27決定）。記録すると変更履歴に残ります。</p>
      <p className="mt-1 text-[12px] text-sub">この操作では、自動請求とサロンのカード必須化は変更されません（OFFのまま）。ただし、これが決まると、別の操作で自動請求を有効にすることをDBが拒否しなくなります。</p>
      <label className="mt-2 flex min-h-[44px] items-start gap-2 text-[12.5px]"><input type="checkbox" className="mt-1 h-5 w-5" checked={ok} onChange={(e) => setOk(e.target.checked)} />上記の内容と、自動請求・カード必須化が変更されないことを確認しました</label>
      <button className="mt-2 min-h-[44px] rounded-full bg-ink px-5 text-[13px] font-semibold text-white disabled:opacity-50" disabled={busy || !ok} onClick={run}>決定済みとして記録する</button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-[12.5px] ${msg.ok ? "text-charcoal" : "font-semibold text-[#8A2E2E]"}`}>{msg.text}</p>}
    </div>
  );
}
