"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { changeHirePlan, closeHireAgreement, openHireAgreement, proxyConfirmHire, recordStylistIntent, switchHireToLegacyRoute } from "@/lib/billing/hire-actions";
import { agreementActions, FEE_ROLE_FIELD_LABEL, FEE_ROLE_GUIDE, FEE_ROLE_LABELS, FEE_ROLE_UNCONFIRMED_GUIDE, yen, type AgreementDetail, type FeeRole } from "@/lib/billing/hire-agreement";

const btn = "min-h-[44px] rounded-full bg-ink px-5 text-[13px] font-semibold text-white disabled:opacity-50";
const btnLine = "min-h-[44px] rounded-full border border-line px-5 text-[13px] font-semibold disabled:opacity-50";
const inp = "min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 text-[13px]";
type R = { success: boolean; error?: string; data?: unknown };

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(f: () => Promise<R>, done = "記録しました。") {
    if (busy) return; setBusy(true); setMsg(null);
    try { const r = await f(); setMsg(r.success ? { ok: true, text: done } : { ok: false, text: r.error ?? "処理を完了できませんでした。" }); if (r.success) router.refresh(); }
    catch { setMsg({ ok: false, text: "通信に失敗しました。結果が不明です。画面を読み込み直して状態を確認してください（確認なしに再操作しないでください）。" }); }
    finally { setBusy(false); }
  }
  return { busy, msg, run };
}
function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  return m ? <p role={m.ok ? "status" : "alert"} className={`mt-2 text-[12.5px] ${m.ok ? "text-charcoal" : "font-semibold text-[#8A2E2E]"}`}>{m.text}</p> : null;
}
const fmtDate = (iso: string) => new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" });

/** 契約をまだ開いていない採用に、契約を作る（運営）。作成しても請求は作られない。 */
export function OpenAgreementButton({ hiringProcessId }: { hiringProcessId: string }) {
  const router = useRouter(); const { busy, msg, run } = useRun();
  return (<div>
    <button className={btn} disabled={busy} onClick={() => run(async () => { const r = await openHireAgreement({ hiringProcessId }); if (r.success && typeof r.data === "string") router.push(`/admin/hire-agreements/${r.data}`); return r; }, "契約を作成しました。")}>契約を作成する（請求は作られません）</button>
    <Msg m={msg} />
  </div>);
}

/** 責任者・運営の操作。★請求は実行されない（自動請求は無効）。操作の可否の最終判断はDB。 */
export function HireAgreementPanel({ d, isResponsible, positionRef = null }: { d: AgreementDetail; isResponsible: boolean; positionRef?: string | null }) {
  const a = d.agreement; const act = agreementActions(a.status, isResponsible, d.proxy_available, d.schedule?.status ?? null, a.legacy_route_released_at != null);
  const { busy, msg, run } = useRun();
  const [date, setDate] = useState(a.start_date ?? ""); const [role, setRole] = useState<FeeRole | "">(a.fee_role ?? "");
  const [roleConfirmed, setRoleConfirmed] = useState(false); const [reason, setReason] = useState(""); const [kind, setKind] = useState<"declined" | "cancelled">("declined"); const [closeReason, setCloseReason] = useState(""); const [switchReason, setSwitchReason] = useState("");
  return (
    <section className="mt-6 space-y-5 rounded-2xl border border-line bg-surface p-4" aria-label="契約の操作">
      {act.recordIntent && (
        <div>
          <h2 className="text-[14px] font-semibold">① 本人の入社意思確認を記録する</h2>
          <p className="mt-1 text-[12px] text-sub">本人への確認は運営（エージェント）が必ず行います（代理・自動確定はありません）。確認できた入社予定日と、本人に確認した登録区分を入力してください。</p>
          <p className="mt-1 text-[12px] text-sub">{FEE_ROLE_GUIDE}</p>
          <p className="mt-1 text-[12px] text-sub">{FEE_ROLE_UNCONFIRMED_GUIDE}</p>
          <p className="mt-1 text-[12px] text-sub">参考（プロフィールの「現在の役職」・自由記入）: <b className="text-charcoal">{positionRef ? positionRef : "未設定"}</b>。参考表示のみで、採用料の区分には自動では使いません。</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-[12px] font-semibold">入社予定日<input type="date" className={inp} value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="text-[12px] font-semibold">{FEE_ROLE_FIELD_LABEL}
              <select className={inp} value={role} onChange={(e) => setRole(e.target.value as FeeRole | "")}><option value="">選択してください</option><option value="stylist">スタイリスト</option><option value="assistant">アシスタント</option></select></label>
          </div>
          <label className="mt-2 flex min-h-[44px] items-start gap-2 text-[12.5px]"><input type="checkbox" className="mt-1 h-5 w-5" checked={roleConfirmed} onChange={(e) => setRoleConfirmed(e.target.checked)} />本人に登録区分を確認しました（担当業務ではなく、登録区分です）</label>
          <button className={`${btn} mt-3`} disabled={busy || !date || !role || !roleConfirmed} onClick={() => run(() => recordStylistIntent({ agreementId: a.id, expectedRevision: a.revision, startDate: date, feeRole: role, roleConfirmedWithStylist: roleConfirmed }))}>入社意思確認を記録する</button>
        </div>)}
      {(a.status === "awaiting_salon" || (a.status === "confirmed" && a.needs_reconfirm)) && (
        <div>
          <h2 className="text-[14px] font-semibold">{a.needs_reconfirm ? "② 変更後の条件のサロンの再確認を待っています" : "② サロンの内定操作を待っています"}</h2>
          <p className="mt-1 text-[12px] text-sub">{a.needs_reconfirm ? "サロンが変更後の条件を確認するまで、請求予定は変更前の条件のままで、請求へは進みません。" : "サロン（店舗の採用管理権限者）が自社の画面で「内定を確定」すると、採用確定になります。"}</p>
          {isResponsible ? (
            act.proxyConfirm ? (<div className="mt-2 space-y-2">
              <p className="text-[12px] text-sub">{a.needs_reconfirm ? "条件の変更から" : "本人の入社意思確認から"}{d.proxy_wait_days}日が経過し、サロンの操作がありません。責任者は理由を記録して代理で確認できます。確認する条件: 入社予定日 <b>{a.start_date}</b> ／ <b>{a.fee_role ? FEE_ROLE_LABELS[a.fee_role] : "—"}</b> ／ {d.current_terms ? <b>{yen(d.current_terms.total)}</b> : <b className="text-[#8A2E2E]">金額の設定が未確定</b>}</p>
              <input className={inp} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="代理操作の理由（必須。例: サロンへ連絡済み・7日間未操作）" />
              <button className={btn} disabled={busy || !reason.trim() || !d.current_terms || !a.start_date || !a.fee_role} onClick={() => run(() => proxyConfirmHire({ agreementId: a.id, reason, expectedRevision: a.revision, startDate: a.start_date!, feeRole: a.fee_role!, totalAmount: d.current_terms!.total }), "代理で確認しました。")}>{a.needs_reconfirm ? "代理で再確認する" : "代理で内定を確定する"}</button></div>)
              : <p className="mt-2 text-[12px] text-sub">代理操作は{d.proxy_available_at ? `${fmtDate(d.proxy_available_at)}以降` : `${d.proxy_wait_days}日後以降`}に可能になります（それまでは操作できません。期間が過ぎても自動では確定しません）。</p>
          ) : <p className="mt-2 text-[12px] text-sub">代理操作は責任者のみ行えます。</p>}
        </div>)}
      {act.changePlan && (
        <div>
          <h2 className="text-[14px] font-semibold">入社予定日・登録区分の変更（責任者のみ）</h2>
          <p className="mt-1 text-[12px] text-sub">確認済みの契約を変更すると、サロンが変更後の条件を確認し直すまで、請求予定は確認済みの条件のままで、請求へは進みません。請求開始後の変更は自動で動かさず、「要確認」になります。登録区分の訂正は、本人に確認し直した結果だけで行い、担当業務の変更では行いません。</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-[12px] font-semibold">入社予定日<input type="date" className={inp} value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="text-[12px] font-semibold">{FEE_ROLE_FIELD_LABEL}<select className={inp} value={role} onChange={(e) => setRole(e.target.value as FeeRole | "")}><option value="stylist">スタイリスト</option><option value="assistant">アシスタント</option></select></label>
          </div>
          <label className="mt-2 flex min-h-[44px] items-start gap-2 text-[12.5px]"><input type="checkbox" className="mt-1 h-5 w-5" checked={roleConfirmed} onChange={(e) => setRoleConfirmed(e.target.checked)} />本人に登録区分を確認し直しました（担当業務の変更ではありません）</label>
          <button className={`${btnLine} mt-3`} disabled={busy || !date || !role || !roleConfirmed} onClick={() => run(() => changeHirePlan({ agreementId: a.id, expectedRevision: a.revision, startDate: date, feeRole: role, roleConfirmedWithStylist: roleConfirmed }), "変更しました。")}>変更する</button>
        </div>)}
      {act.close && (
        <div>
          <h2 className="text-[14px] font-semibold">辞退・取消（責任者のみ）</h2>
          <p className="mt-1 text-[12px] text-sub">請求前（未請求）に辞退・取消にすると、請求せずに請求予定が取り消されます。請求が始まった後に辞退・取消にすると、請求予定は取り消さず「要確認」の印が付き、返金は確認後に運営が手動で行います（自動返金なし）。旧成功報酬の経路へは自動では戻りません。</p>
          <div className="mt-2 space-y-2">
            <select className={inp} value={kind} onChange={(e) => setKind(e.target.value as "declined" | "cancelled")} aria-label="種別"><option value="declined">辞退（本人・サロンの辞退）</option><option value="cancelled">取消（運営の判断）</option></select>
            <input className={inp} value={closeReason} onChange={(e) => setCloseReason(e.target.value)} placeholder="理由（必須）" />
            <button className={btnLine} disabled={busy || !closeReason.trim()} onClick={() => run(() => closeHireAgreement({ agreementId: a.id, expectedRevision: a.revision, kind, reason: closeReason }), "記録しました。")}>辞退・取消として記録する</button>
          </div>
        </div>)}
      {act.switchToLegacy && (
        <div>
          <h2 className="text-[14px] font-semibold">旧方式（旧成功報酬）へ切り替える（責任者のみ）</h2>
          <p className="mt-1 text-[12px] text-sub">請求予定の取消だけでは、旧成功報酬の経路には戻りません。この採用を旧方式で扱う必要が確認できたときだけ、理由を残して切り替えます。請求が始まった契約には使えません。</p>
          <div className="mt-2 space-y-2">
            <input className={inp} value={switchReason} onChange={(e) => setSwitchReason(e.target.value)} placeholder="切替の理由（必須）" />
            <button className={btnLine} disabled={busy || !switchReason.trim()} onClick={() => run(() => switchHireToLegacyRoute({ agreementId: a.id, expectedRevision: a.revision, reason: switchReason }), "旧方式へ切り替えました。")}>旧方式へ切り替える</button>
          </div>
        </div>)}
      {!act.recordIntent && a.status !== "awaiting_salon" && !act.changePlan && !act.close && !act.switchToLegacy && <p className="text-[12.5px] text-sub">この状態で行える操作はありません。</p>}
      <Msg m={msg} />
      <p className="text-[11.5px] text-sub">本人に確認した登録区分: {a.fee_role ? FEE_ROLE_LABELS[a.fee_role] : "未入力"}</p>
    </section>
  );
}
