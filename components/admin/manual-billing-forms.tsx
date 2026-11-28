"use client";

import { useState, useTransition } from "react";
import { createManualInvoice, recordManualPayment, reverseManualPayment, voidManualInvoice } from "@/lib/billing/manual-billing-actions";
import { KIND_LABELS, METHOD_LABELS, yen, type Candidate, type PayMethod } from "@/lib/billing/manual-billing";

const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + 9 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
const fieldCls = "min-h-[44px] rounded-lg border border-line bg-surface px-3 text-[13px]";
function useMsg() { const [m, setM] = useState<{ ok: boolean; t: string } | null>(null); return [m, setM] as const; }

/** 請求書の発行（候補ごと）。支払期限の既定は14日後。 */
export function CandidateRow({ c }: { c: Candidate }) {
  const [due, setDue] = useState(plusDays(14)); const [pending, start] = useTransition(); const [m, setM] = useMsg();
  return (
    <li className="rounded-xl border border-line bg-surface p-3 text-[12.5px]">
      <p className="font-semibold text-ink">{c.org_name}　{KIND_LABELS[c.kind]}　{yen(c.total_amount)}（税込）</p>
      <p className="mt-1 flex flex-wrap items-center gap-2">
        <label className="text-sub">支払期限<input type="date" value={due} min={today()} max={plusDays(120)} onChange={(e) => setDue(e.target.value)} className={`${fieldCls} ml-2`} /></label>
        <button type="button" disabled={pending} className="min-h-[44px] rounded-full bg-ink px-4 font-semibold text-white disabled:opacity-40" onClick={() => {
          if (!window.confirm(`${c.org_name} に ${KIND_LABELS[c.kind]} ${yen(c.total_amount)}（税込）の請求書を発行します。${c.kind === "hire_fee" ? "採用料は自動請求の対象から外れます。" : "カード決済は開始できなくなります。"}よろしいですか？`)) return;
          start(async () => { const r = await createManualInvoice({ kind: c.kind, sourceId: c.source_id, dueOn: due }); setM({ ok: r.success, t: r.success ? "請求書を発行しました。" : r.error }); });
        }}>請求書を発行</button>
      </p>
      {m && <p role="status" className={m.ok ? "mt-1 text-[#2E8B7F]" : "mt-1 text-[#8A2E2E]"}>{m.t}</p>}
    </li>
  );
}

export function PaymentForm({ invoiceId, outstanding }: { invoiceId: string; outstanding: number }) {
  const [amount, setAmount] = useState(String(outstanding)); const [on, setOn] = useState(today()); const [method, setMethod] = useState<PayMethod>("bank_transfer"); const [ref, setRef] = useState(""); const [note, setNote] = useState("");
  const [pending, start] = useTransition(); const [m, setM] = useMsg();
  return (
    <form className="mt-3 grid gap-2 rounded-2xl border border-line bg-surface p-4 text-[12.5px] sm:grid-cols-2" onSubmit={(e) => {
      e.preventDefault(); const n = Number(amount);
      if (!Number.isInteger(n) || n <= 0) { setM({ ok: false, t: "金額を正しく入力してください。" }); return; }
      if (!window.confirm(`入金 ${yen(n)}（${on}・${METHOD_LABELS[method]}）を記録します。入金を確認済みですか？`)) return;
      start(async () => { const r = await recordManualPayment({ invoiceId, amount: n, receivedOn: on, method, reference: ref, note }); setM({ ok: r.success, t: r.success ? "入金を記録しました。" : r.error }); });
    }}>
      <label>入金額（円）<input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${fieldCls} mt-1 block w-full`} /></label>
      <label>入金日<input type="date" value={on} max={today()} onChange={(e) => setOn(e.target.value)} className={`${fieldCls} mt-1 block w-full`} /></label>
      <label>方法<select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)} className={`${fieldCls} mt-1 block w-full`}>{(Object.keys(METHOD_LABELS) as PayMethod[]).map((k) => <option key={k} value={k}>{METHOD_LABELS[k]}</option>)}</select></label>
      <label>参照メモ（振込名義・日付など。口座番号は書かない）<input maxLength={200} value={ref} onChange={(e) => setRef(e.target.value)} className={`${fieldCls} mt-1 block w-full`} /></label>
      <label className="sm:col-span-2">備考<input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={`${fieldCls} mt-1 block w-full`} /></label>
      <p className="sm:col-span-2"><button type="submit" disabled={pending} className="min-h-[44px] rounded-full bg-ink px-5 font-semibold text-white disabled:opacity-40">入金を記録する</button></p>
      {m && <p role="status" className={`sm:col-span-2 ${m.ok ? "text-[#2E8B7F]" : "text-[#8A2E2E]"}`}>{m.t}</p>}
    </form>
  );
}

export function ReverseButton({ invoiceId, paymentId }: { invoiceId: string; paymentId: string }) {
  const [pending, start] = useTransition(); const [m, setM] = useMsg();
  return (<span><button type="button" disabled={pending} className="min-h-[44px] rounded-full border border-line px-3 text-[12px] font-semibold text-[#8A2E2E]" onClick={() => { const reason = window.prompt("この入金を取り消す理由（必須）"); if (!reason) return; start(async () => { const r = await reverseManualPayment({ invoiceId, paymentId, reason }); setM({ ok: r.success, t: r.success ? "取り消しました。" : r.error }); }); }}>入金を取り消す</button>{m && <span role="status" className={m.ok ? "ml-2 text-[#2E8B7F]" : "ml-2 text-[#8A2E2E]"}>{m.t}</span>}</span>);
}
export function VoidButton({ invoiceId }: { invoiceId: string }) {
  const [pending, start] = useTransition(); const [m, setM] = useMsg();
  return (<p className="mt-4"><button type="button" disabled={pending} className="min-h-[44px] rounded-full border border-line px-4 text-[12.5px] font-semibold text-[#8A2E2E]" onClick={() => { const reason = window.prompt("請求を取り消す理由（必須。入金が無い請求だけ取り消せます）"); if (!reason) return; start(async () => { const r = await voidManualInvoice({ invoiceId, reason }); setM({ ok: r.success, t: r.success ? "請求を取り消しました。" : r.error }); }); }}>この請求を取り消す</button>{m && <span role="status" className={m.ok ? "ml-2 text-[#2E8B7F]" : "ml-2 text-[#8A2E2E]"}>{m.t}</span>}</p>);
}
