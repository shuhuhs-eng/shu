"use client";

import { useRef, useState, useTransition } from "react";
import { cancelIssuanceAction, issueSalonAccountAction, resendSetPasswordAction } from "@/lib/admin/salon-issue-actions";
import { REGISTRATION_PLANS, type RegistrationPlanCode } from "@/lib/billing/scout-credit-rules";

export type IssuanceRow = { request_id: string; email: string; display_name: string; plan_label: string; status: "pending" | "issued" | "linked" | "cancelled"; created_at: string };
const STATUS: Record<IssuanceRow["status"], string> = { pending: "手続き中（アカウント未作成）", issued: "発行済み（会社の登録待ち）", linked: "会社の登録まで完了", cancelled: "取消" };

/** 運営（責任者）: サロンアカウントの発行。登録料は本部が直接徴収する（この画面では決済しない）。 */
export function SalonIssueForm({ rows }: { rows: IssuanceRow[] }) {
  const [email, setEmail] = useState(""); const [name, setName] = useState(""); const [plan, setPlan] = useState<RegistrationPlanCode | "">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const reqId = useRef<{ key: string; id: string } | null>(null);   // 同じ内容の再実行は同じ requestId（二重発行しない）
  const key = `${email.trim().toLowerCase()}|${name.trim()}|${plan}`;
  const rid = () => { if (!reqId.current || reqId.current.key !== key) reqId.current = { key, id: crypto.randomUUID() }; return reqId.current.id; };
  const q = plan ? REGISTRATION_PLANS[plan] : null;
  return (
    <>
      <form className="mt-5 space-y-3 rounded-2xl border border-line bg-surface p-5" onSubmit={(e) => {
        e.preventDefault(); if (!plan || !q) return;
        if (!window.confirm(`${email} に「${q.label}」（初回スカウト${q.initialGrant}件）でアカウントを発行し、パスワード設定のメールを送ります。よろしいですか？`)) return;
        start(async () => { const r = await issueSalonAccountAction({ requestId: rid(), email, displayName: name, plan }); setMsg({ ok: r.ok, text: r.message }); if (r.ok && r.settled) { setEmail(""); setName(""); setPlan(""); reqId.current = null; } });
      }}>
        <label className="block text-[12px] text-ink">メールアドレス（担当者）<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 block min-h-[44px] w-full rounded-lg border border-line bg-surface px-3 text-[13px]" autoComplete="off" /></label>
        <label className="block text-[12px] text-ink">サロン名（後から変更できます）<input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block min-h-[44px] w-full rounded-lg border border-line bg-surface px-3 text-[13px]" /></label>
        <fieldset className="text-[12px] text-ink"><legend>登録区分（本部が選択）</legend>
          {(Object.keys(REGISTRATION_PLANS) as RegistrationPlanCode[]).map((k) => (
            <label key={k} className="mt-1 flex min-h-[44px] items-center gap-2"><input type="radio" name="plan" checked={plan === k} onChange={() => setPlan(k)} />{REGISTRATION_PLANS[k].label}（登録料 税込{REGISTRATION_PLANS[k].feeInclTax.toLocaleString("ja-JP")}円・初回スカウト{REGISTRATION_PLANS[k].initialGrant}件）</label>))}
        </fieldset>
        <p className="text-[11px] text-sub">登録料は本部が直接徴収します（この画面では決済しません）。初回スカウトは、サロンが店舗登録を終えた時点で、選んだ区分の件数が付与の対象になります。</p>
        <button type="submit" disabled={pending || !plan || !email || !name} className="min-h-[44px] rounded-full bg-ink px-6 text-[13px] font-semibold text-white disabled:opacity-40">{pending ? "発行中…" : "アカウントを発行する"}</button>
        {msg && <p role="status" className={`text-[12.5px] ${msg.ok ? "text-[#2E8B7F]" : "text-[#8A2E2E]"}`}>{msg.text}</p>}
      </form>
      <h2 className="mt-8 font-serif text-lg font-bold text-ink">発行の状況</h2>
      {rows.length === 0 ? <p className="mt-2 text-[12.5px] text-sub">まだ発行していません。</p> : (
        <ul className="mt-2 space-y-2">{rows.map((r) => (
          <li key={r.request_id} className="rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
            <p className="break-words font-semibold text-ink">{r.display_name}　<span className="font-normal text-sub">{r.email}</span></p>
            <p className="mt-1 text-sub">{r.plan_label}／{STATUS[r.status]}</p>
            {(r.status === "issued" || r.status === "pending") && (
              <p className="mt-2 flex flex-wrap gap-2">
                {r.status === "issued" && <button type="button" disabled={pending} className="min-h-[44px] rounded-full border border-line px-4 font-semibold" onClick={() => start(async () => { const x = await resendSetPasswordAction({ requestId: r.request_id }); setMsg({ ok: x.ok, text: x.message }); })}>メールを再送</button>}
                <button type="button" disabled={pending} className="min-h-[44px] rounded-full border border-line px-4 font-semibold text-[#8A2E2E]" onClick={() => { const reason = window.prompt("取り消す理由（必須）"); if (!reason) return; start(async () => { const x = await cancelIssuanceAction({ requestId: r.request_id, reason }); setMsg({ ok: x.ok, text: x.message }); }); }}>発行を取り消す</button>
              </p>)}
          </li>))}</ul>)}
    </>
  );
}
