"use client";

import { useState } from "react";
import { respondSalaryOffer } from "@/lib/salary-offers/actions";
import type { Database } from "@/types/database";
type Offer = Database["public"]["Tables"]["salary_offers"]["Row"];
const REASONS = [["workdays","勤務日数・休日"],["guarantee_period","保証期間"],["role","役割・業務範囲"],["performance_basis","実績の評価方法"],["other","その他"]] as const;
const STATUS_LABELS: Record<string,string> = { accepted:"承諾", revision_requested:"条件を相談", declined:"辞退", withdrawn:"取り下げ", pending:"回答待ち" };

// ★1サロンにつき1カード方針: このコンポーネントは「そのサロンの最新offer(offer)」
// だけを回答対象として表示する。過去のoffer(history)は折りたたみ内に読み取り専用で
// 表示するだけで、承諾/相談/辞退ボタンは一切出さない。
export function StylistOfferCard({ offer, salonName, history }: { offer: Offer; salonName: string; history: Offer[] }) {
  const [reason,setReason]=useState<typeof REASONS[number][0]>("performance_basis"); const [note,setNote]=useState(""); const [busy,setBusy]=useState(false); const [msg,setMsg]=useState<string|null>(null);
  // 二段階方式: 最初のボタンでは確定させず、確認状態を経てから初めてrespondSalaryOfferを呼ぶ。
  // 「戻る」はDB送信前のUI状態を選択肢(choice)へ戻すだけで、送信済みstatusには一切影響しない。
  const [step,setStep]=useState<"choice"|"accept"|"consult"|"decline">("choice");
  async function answer(response:"accepted"|"revision_requested"|"declined") { setBusy(true); setMsg(null); const r=await respondSalaryOffer({offerId:offer.id,response,reason:response==="revision_requested"?reason:null,note:response==="revision_requested"?(note||null):null}); setBusy(false); setMsg(r.success?"回答を送信しました。":r.error); }
  return <article className="rounded-2xl border border-line bg-surface p-5"><p className="eyebrow mb-1">実績オファー</p><h3 className="font-serif text-lg font-bold text-ink">{salonName}</h3><div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-surface2 p-2"><p className="text-[10px] text-sub">月額保証</p><p className="mt-1 text-[13px] font-bold">{offer.monthly_guarantee.toLocaleString()}円</p></div><div className="rounded-lg bg-surface2 p-2"><p className="text-[10px] text-sub">実績加算</p><p className="mt-1 text-[13px] font-bold">{offer.performance_addition.toLocaleString()}円</p></div><div className="rounded-lg bg-surface2 p-2"><p className="text-[10px] text-sub">保証期間</p><p className="mt-1 text-[13px] font-bold">{offer.guarantee_months}か月</p></div></div>
  {offer.performance_addition > 0 && <div className="mt-3 rounded-lg border border-line bg-surface2 p-3"><p className="text-[10px] font-semibold text-sub">支給条件</p><p className="mt-1 text-[12px] leading-relaxed text-charcoal">{offer.performance_condition ?? "未記載"}</p></div>}
  {offer.salon_message&&<p className="mt-3 text-[12px] leading-relaxed text-charcoal">{offer.salon_message}</p>}<p className="mt-3 text-[10px] text-sub">これは面談前の条件提示であり、雇用契約の確定ではありません。</p>
  {offer.status==="pending"&&<>
    {step==="choice"&&<div className="mt-4 grid grid-cols-3 gap-2"><button disabled={busy} onClick={()=>setStep("accept")} className="rounded-full bg-[#285B45] py-2 text-[11px] font-bold text-white">承諾する</button><button disabled={busy} onClick={()=>setStep("consult")} className="rounded-full border border-line py-2 text-[11px]">条件を相談</button><button disabled={busy} onClick={()=>setStep("decline")} className="rounded-full border border-line py-2 text-[11px] text-sub">辞退する</button></div>}
    {step==="accept"&&<div className="mt-4"><p className="text-[12px] font-semibold text-charcoal">この条件で承諾しますか？</p><div className="mt-2 grid grid-cols-2 gap-2"><button disabled={busy} onClick={()=>setStep("choice")} className="rounded-full border border-line py-2 text-[11px]">戻る</button><button disabled={busy} onClick={()=>answer("accepted")} className="rounded-full bg-[#285B45] py-2 text-[11px] font-bold text-white">{busy?"送信中...":"承諾を確定"}</button></div></div>}
    {step==="consult"&&<div className="mt-4"><select value={reason} onChange={(e)=>setReason(e.target.value as typeof reason)} className="w-full rounded-lg border border-line px-3 py-2 text-[11px]">{REASONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><textarea value={note} onChange={(e)=>setNote(e.target.value)} maxLength={500} placeholder="相談したい内容（任意）" className="mt-2 min-h-16 w-full rounded-lg border border-line px-3 py-2 text-[11px]"/><div className="mt-2 grid grid-cols-2 gap-2"><button disabled={busy} onClick={()=>setStep("choice")} className="rounded-full border border-line py-2 text-[11px]">戻る</button><button disabled={busy} onClick={()=>answer("revision_requested")} className="rounded-full bg-ink py-2 text-[11px] font-bold text-surface">{busy?"送信中...":"相談を送る"}</button></div></div>}
    {step==="decline"&&<div className="mt-4"><p className="text-[12px] font-semibold text-charcoal">この給与条件を辞退しますか？</p><div className="mt-2 grid grid-cols-2 gap-2"><button disabled={busy} onClick={()=>setStep("choice")} className="rounded-full border border-line py-2 text-[11px]">戻る</button><button disabled={busy} onClick={()=>answer("declined")} className="rounded-full border border-[#8A2E2E]/30 py-2 text-[11px] font-bold text-[#8A2E2E]">{busy?"送信中...":"辞退を確定"}</button></div></div>}
  </>}
  {offer.status!=="pending"&&<p className="mt-3 text-[11px] font-semibold text-sub">回答済み: {STATUS_LABELS[offer.status]??offer.status}</p>}{msg&&<p className="mt-2 text-[11px] text-charcoal">{msg}</p>}
  {history.length>0&&<details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-[11px] font-semibold text-sub underline">過去の提示を見る（{history.length}件）</summary><div className="mt-3 space-y-2">{history.map((past)=><div key={past.id} className="rounded-lg border border-line bg-surface2 p-3 text-[11px] text-charcoal"><p className="text-[10px] text-sub">{new Date(past.created_at).toLocaleString("ja-JP")} 提示</p><p className="mt-1">月額保証 {past.monthly_guarantee.toLocaleString()}円 / 実績加算 {past.performance_addition.toLocaleString()}円 / 保証期間 {past.guarantee_months}か月</p>{past.performance_addition>0&&<p className="mt-1 text-sub">支給条件: {past.performance_condition ?? "未記載"}</p>}<p className="mt-1 font-semibold">回答: {STATUS_LABELS[past.status]??past.status}</p></div>)}</div></details>}
  </article>;
}
