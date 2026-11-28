"use client";

import { useState, useTransition } from "react";
import { setScoutRegistration } from "@/lib/billing/scout-registration-actions";
import { REGISTRATION_PLANS, type RegistrationPlanCode } from "@/lib/billing/scout-credit-rules";

/** 運営（責任者）: 法人のスカウト登録区分。初回付与の後は変更できない。登録料の請求・入金はこの画面では行わない。 */
export function ScoutRegistrationForm({ organizationId, current, locked }: { organizationId: string; current: RegistrationPlanCode | null; locked: boolean }) {
  const [plan, setPlan] = useState<RegistrationPlanCode | "">(current ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const p = plan ? REGISTRATION_PLANS[plan] : null;
  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-5" aria-label="登録区分">
      <h2 className="text-[13px] font-bold text-ink">登録区分</h2>
      <p className="mt-1 text-[12px] text-sub">
        {current ? `現在: ${REGISTRATION_PLANS[current].label}（登録料 税込${REGISTRATION_PLANS[current].feeInclTax.toLocaleString("ja-JP")}円・初回スカウト${REGISTRATION_PLANS[current].initialGrant}件）` : "未設定です。設定するまで初回のスカウトは付与されません。"}
        {locked ? " 初回付与が済んでいるため、変更できません。" : ""}
      </p>
      {!locked && (
        <form className="mt-3 flex flex-wrap items-center gap-3" onSubmit={(e) => {
          e.preventDefault(); if (!plan) return;
          const q = REGISTRATION_PLANS[plan];
          if (!window.confirm(`「${q.label}」（登録料 税込${q.feeInclTax.toLocaleString("ja-JP")}円・初回${q.initialGrant}件）に設定します。初回付与の後は変更できません。よろしいですか？`)) return;
          start(async () => { const r = await setScoutRegistration({ organizationId, plan }); setMsg(r.success ? { ok: true, text: "設定しました。" } : { ok: false, text: r.error }); });
        }}>
          <label className="text-[12px] text-ink">区分
            <select value={plan} onChange={(e) => setPlan(e.target.value as RegistrationPlanCode | "")} className="ml-2 min-h-[44px] rounded-lg border border-line bg-surface px-3 text-[13px]">
              <option value="">選択してください</option>
              {(Object.keys(REGISTRATION_PLANS) as RegistrationPlanCode[]).map((k) => <option key={k} value={k}>{REGISTRATION_PLANS[k].label}（税込{REGISTRATION_PLANS[k].feeInclTax.toLocaleString("ja-JP")}円・初回{REGISTRATION_PLANS[k].initialGrant}件）</option>)}
            </select>
          </label>
          <button type="submit" disabled={pending || !plan || plan === current} className="min-h-[44px] rounded-full bg-ink px-5 text-[12.5px] font-semibold text-white disabled:opacity-40">{pending ? "設定中…" : "設定する"}</button>
        </form>
      )}
      {p && !locked && <p className="mt-2 text-[11px] text-sub">登録料は本部が直接徴収します（この画面・システムでは決済しません）。</p>}
      {msg && <p role="status" className={`mt-2 text-[12px] ${msg.ok ? "text-[#2E8B7F]" : "text-[#8A2E2E]"}`}>{msg.text}</p>}
    </section>
  );
}
