"use client";

import { useState } from "react";
import { createSalaryOffer } from "@/lib/salary-offers/actions";
import type { Database } from "@/types/database";
type Offer = Database["public"]["Tables"]["salary_offers"]["Row"];
const RESPONSE_REASONS: Record<string,string> = { workdays:"勤務日数・休日", guarantee_period:"保証期間", role:"役割・業務範囲", performance_basis:"実績の評価方法", other:"その他" };

export function SalonOfferForm({ stylistUserId, existingOffer }: { stylistUserId: string; existingOffer: Offer | null }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null);
  const [guarantee, setGuarantee] = useState(250000); const [addition, setAddition] = useState(0); const [condition, setCondition] = useState(""); const [months, setMonths] = useState<1|3|6|12>(3); const [note, setNote] = useState("");
  if (existingOffer?.status === "pending") return <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-[11px] font-semibold text-sub">給与条件を提示済み・回答待ちです</p>;
  if (existingOffer?.status === "accepted") return <p className="mt-3 rounded-lg bg-[#37755B]/10 px-3 py-2 text-[11px] font-semibold text-[#285B45]">提示条件が承諾されました。次は面談で正式条件を確認してください。</p>;
  if (!open && existingOffer?.status === "revision_requested") return <div className="mt-3 rounded-lg bg-surface px-3 py-3 text-[11px] text-charcoal"><p className="font-bold">条件相談が届いています：{RESPONSE_REASONS[existingOffer.response_reason ?? ""] ?? "その他"}</p>{existingOffer.response_note && <p className="mt-1 text-sub">{existingOffer.response_note}</p>}<button type="button" onClick={()=>setOpen(true)} className="mt-2 underline">条件を再提示する</button></div>;
  if (!open && existingOffer?.status === "declined") return <div className="mt-3 rounded-lg bg-surface px-3 py-3 text-[11px] text-sub">前回の提示は辞退されました。<button type="button" onClick={()=>setOpen(true)} className="ml-1 underline">条件を見直して再提示</button></div>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="mt-3 w-full rounded-full bg-ink px-4 py-3 text-[12px] font-bold text-surface">確認済み実績をもとに条件を提示</button>;
  const conditionRequired = addition > 0;
  const conditionMissing = conditionRequired && condition.trim() === "";
  async function submit() {
    if (conditionMissing) { setMessage("実績加算を設定する場合は、支給条件を入力してください。"); return; }
    setBusy(true); setMessage(null);
    const result = await createSalaryOffer({ stylistUserId, monthlyGuarantee: guarantee, performanceAddition: addition, performanceCondition: condition.trim() || null, guaranteeMonths: months, message: note || null });
    setBusy(false); setMessage(result.success ? "条件を提示しました。" : result.error);
  }
  return <div className="mt-3 rounded-xl border border-line bg-surface p-4">
    <p className="text-[12px] font-bold text-ink">給与条件を提示</p><p className="mt-1 text-[10.5px] text-sub">雇用契約の確定ではありません。</p>
    <label className="mt-3 block text-[11px] text-charcoal">月額保証<input type="number" min="100000" step="10000" value={guarantee} onChange={(e)=>setGuarantee(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-line px-3 py-2" /></label>
    <label className="mt-3 block text-[11px] text-charcoal">実績加算（月額・なしは0円）<input type="number" min="0" step="10000" value={addition} onChange={(e)=>setAddition(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-line px-3 py-2" /></label>
    {conditionRequired && <label className="mt-3 block text-[11px] text-charcoal">支給条件（実績加算を支給する条件） *<textarea value={condition} onChange={(e)=>setCondition(e.target.value)} maxLength={500} placeholder="例：指名客数が月間◯名を超えた場合に加算分を支給" className="mt-1 min-h-16 w-full rounded-lg border border-line px-3 py-2 text-[11px]" />{conditionMissing && <span className="mt-1 block text-[10.5px] text-[#8A2E2E]">実績加算を設定する場合は、支給条件の入力が必須です。</span>}</label>}
    <label className="mt-3 block text-[11px] text-charcoal">保証期間<select value={months} onChange={(e)=>setMonths(Number(e.target.value) as 1|3|6|12)} className="mt-1 w-full rounded-lg border border-line px-3 py-2"><option value={1}>1か月</option><option value={3}>3か月</option><option value={6}>6か月</option><option value={12}>12か月</option></select></label>
    <textarea value={note} onChange={(e)=>setNote(e.target.value)} maxLength={500} placeholder="補足メッセージ（任意）" className="mt-3 min-h-16 w-full rounded-lg border border-line px-3 py-2 text-[11px]" />
    <div className="mt-3 flex gap-2"><button type="button" onClick={()=>setOpen(false)} className="flex-1 rounded-full border border-line py-2 text-[11px]">閉じる</button><button type="button" disabled={busy || conditionMissing} onClick={submit} className="flex-1 rounded-full bg-ink py-2 text-[11px] font-bold text-surface disabled:opacity-50">{busy?"送信中...":"提示する"}</button></div>
    {message && <p className="mt-2 text-[11px] text-charcoal">{message}</p>}
  </div>;
}
