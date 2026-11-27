"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { salonConfirmOffer } from "@/lib/billing/hire-actions";
import { FEE_ROLE_LABELS, yen, type SalonAgreementView } from "@/lib/billing/hire-agreement";

/**
 * サロンの内定操作と、条件変更後の再確認（店舗の採用管理権限者）。本人の入社意思確認（運営が実施）が済んでから押せる。
 * ★画面が見た「版・入社予定日・登録区分・金額」をそのままDBへ送る。画面が古い（他の方が先に変更した・料金設定が変わった）ときはDBが拒否する。
 * ★金額は仮表示（料金表示・利用条件は法務確認待ち）。実際の請求は、運営が自動請求を有効にするまで行われない。
 */
export function HireConfirmCard({ v }: { v: SalonAgreementView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [agree, setAgree] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const reconfirm = v.status === "confirmed" && v.needs_reconfirm;
  const canConfirm = (v.status === "awaiting_salon" || reconfirm) && v.start_date != null && v.fee_role != null && v.total_amount != null;
  async function confirm() {
    if (busy || !canConfirm) return; setBusy(true); setMsg(null);
    try {
      const r = await salonConfirmOffer({ agreementId: v.agreement_id, expectedRevision: v.revision, startDate: v.start_date!, feeRole: v.fee_role!, totalAmount: v.total_amount! });
      setMsg(r.success ? { ok: true, text: reconfirm ? "変更後の内容を確認しました。" : "内定を確定しました。" } : { ok: false, text: r.error }); if (r.success) router.refresh();
    } catch { setMsg({ ok: false, text: "通信に失敗しました。結果が不明です。画面を読み込み直して状態を確認してください（確認なしに再操作しないでください）。" }); }
    finally { setBusy(false); }
  }
  const terms = (
    <p className="text-[12.5px] text-sub">入社予定日: <b className="text-charcoal">{v.start_date ?? "未定"}</b> ／ 本人に確認済みの登録区分: <b className="text-charcoal">{v.fee_role ? FEE_ROLE_LABELS[v.fee_role] : "未定"}</b>
      {v.total_amount != null && <> ／ 採用料（仮表示）: 税抜 {yen(v.fee_excl_tax!)} ＋ 税 {yen(v.tax!)} ＝ <b className="text-charcoal">{yen(v.total_amount)}</b>（請求予定日 {v.charge_on ?? "—"}・入社予定日の翌日）</>}</p>
  );
  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-4" aria-label="入社の確認">
      <h2 className="text-[14px] font-semibold">入社の確認（採用料の請求予定）</h2>
      {v.status === "awaiting_intent" && <p className="mt-2 text-[12.5px] text-sub">本人の入社意思確認を運営が行っています。確認が済むと、ここから内定を確定できます。</p>}
      {(v.status === "awaiting_salon" || reconfirm) && (<div className="mt-2 space-y-2">
        {reconfirm ? <p role="alert" className="rounded-xl bg-[#C24545]/10 px-3 py-2 text-[12.5px] font-semibold text-[#8A2E2E]">確認済みの条件が変更されました。内容を確認し直すまで、請求予定は変更前の条件のままで、請求へは進みません。</p>
          : <p className="text-[12.5px] text-sub">運営が本人の入社意思を確認しました。</p>}
        {reconfirm && v.confirmed && <p className="text-[12.5px] text-sub">確認済みだった条件: 入社予定日 {v.confirmed.start_date} ／ {FEE_ROLE_LABELS[v.confirmed.fee_role]} ／ {yen(v.confirmed.total_amount)}（請求予定日 {v.confirmed.charge_on}）</p>}
        {reconfirm && <p className="text-[12.5px] font-semibold">変更後の条件</p>}
        {terms}
        <p className="text-[12px] text-sub">登録区分は、運営が美容師本人に確認した登録時の区分です。入社後に担当する業務では変わりません。</p>
        {v.total_amount == null && <p role="alert" className="text-[12.5px] font-semibold text-[#8A2E2E]">採用料の設定が未確定のため、確認できません。運営へご連絡ください。</p>}
        <p className="rounded-xl bg-surface2 p-3 text-[12px] text-sub">{reconfirm ? "確認すると、請求予定の金額・登録区分が上記の条件へ更新されます（請求日は、最初に登録された入社予定日の翌日のまま変わりません）。" : "内定を確定すると、採用確定として記録され、最初に登録された入社予定日の翌日に採用料の請求予定が作られます（後から入社予定日が変わっても、請求日は変わりません）。"}<b>実際の請求は、運営が自動請求を有効にするまで行われません。</b></p>
        <label className="flex min-h-[44px] items-start gap-2 text-[12.5px]"><input type="checkbox" className="mt-1 h-5 w-5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />上記（入社予定日・本人に確認済みの登録区分・採用料の請求予定）を確認しました</label>
        <button className="min-h-[44px] rounded-full bg-ink px-5 text-[13px] font-semibold text-white disabled:opacity-50" disabled={busy || !agree || !canConfirm} onClick={confirm}>{reconfirm ? "変更後の内容を確認する" : "内定を確定する"}</button>
      </div>)}
      {v.status === "confirmed" && !reconfirm && <div className="mt-2 space-y-1"><p className="text-[12.5px] text-sub">採用確定済みです。確認した条件:</p>{terms}</div>}
      {(v.status === "declined" || v.status === "cancelled") && <p className="mt-2 text-[12.5px] text-sub">この採用は{v.status === "declined" ? "辞退" : "取消"}として記録されています。</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-[12.5px] ${msg.ok ? "text-charcoal" : "font-semibold text-[#8A2E2E]"}`}>{msg.text}</p>}
    </section>
  );
}
