"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { assignVisitRequest, recordVisitConfirmation, updateVisitRequest } from "@/lib/admin/visit-requests-actions";
import { CLOSED_REASON_LABELS, CONFIRM_LABELS, NEXT_STATUSES, STATUS_LABELS, type VisitDetail } from "@/lib/admin/visit-requests-shared";

const sel = "min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 text-[13px]";
const btn = "min-h-[44px] rounded-full bg-ink px-5 text-[13px] font-semibold text-white disabled:opacity-50";

/** 状態の更新・実施後の確認記録（運営のみ）。画面の選択肢は目安で、最終判断はDB。更新時刻が違えば「他の担当者が先に更新」と表示して上書きしない。 */
export function VisitRequestPanel({ d, mergeCandidates, meId }: { d: VisitDetail; mergeCandidates: { id: string; label: string }[]; meId: string }) {
  const router = useRouter();
  const nexts = NEXT_STATUSES[d.status] ?? [];
  const [status, setStatus] = useState(nexts[0] ?? "");
  const [date, setDate] = useState(d.scheduled_on ?? "");
  const [note, setNote] = useState(d.internal_note ?? "");
  const [reason, setReason] = useState("");
  const [mergedInto, setMergedInto] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [party, setParty] = useState<"salon" | "stylist">("salon");
  const [result, setResult] = useState<"held" | "not_held">("held");
  const [channel, setChannel] = useState<"message" | "phone" | "other">("message");
  const [cnote, setCnote] = useState("");
  const [assignee, setAssignee] = useState<"me" | "none">(d.assigned_admin_id === meId ? "me" : "none");

  async function assign() {
    if (busy) return;
    setBusy(true); setMsg(null);
    const r = await assignVisitRequest({ id: d.id, adminId: assignee === "me" ? meId : null, expectedUpdatedAt: d.updated_at });
    setBusy(false);
    if (r.success) router.refresh(); else setMsg(r.error);
  }

  async function save() {
    if (busy || !status) return;
    setBusy(true); setMsg(null);
    const r = await updateVisitRequest({
      id: d.id, status: status as never, expectedUpdatedAt: d.updated_at, scheduledOn: date || null,
      note: note.trim() === (d.internal_note ?? "") ? null : note, closedReason: status === "closed" ? ((reason || null) as never) : null,
      mergedInto: status === "closed" && reason === "duplicate" ? mergedInto || null : null,
    });
    setBusy(false);
    if (r.success) router.refresh(); else setMsg(r.error);
  }
  async function confirm() {
    if (busy) return;
    setBusy(true); setMsg(null);
    const r = await recordVisitConfirmation({ requestId: d.id, party, result, channel, note: cnote.trim() || null });
    setBusy(false);
    if (r.success) { setCnote(""); router.refresh(); } else setMsg(r.error);
  }

  return (
    <div className="mt-6 space-y-6">
      {nexts.length === 0 ? (
        <p className="rounded-lg bg-surface2 px-3 py-2 text-[12px] text-sub">この受付は終了しています。実施済み・終了した受付は、日付や状態を変更できません。</p>
      ) : (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-[13px] font-bold text-ink">状態を更新する</h2>
          <div className="mt-3 grid gap-3">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={sel} aria-label="次の状態">
              {nexts.map((s) => <option key={s} value={s}>{s === d.status ? `${STATUS_LABELS[s]}（日付だけ変更）` : STATUS_LABELS[s]}</option>)}
            </select>
            {(status === "scheduled" || d.scheduled_on) && (
              <label className="text-[12px] text-sub">実施日（日本時間）<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={sel + " mt-1"} /></label>
            )}
            {status === "closed" && (
              <>
                <select value={reason} onChange={(e) => setReason(e.target.value)} className={sel} aria-label="終了の理由">
                  <option value="">終了の理由を選ぶ</option>
                  {Object.entries(CLOSED_REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                {reason === "duplicate" && (
                  <select value={mergedInto} onChange={(e) => setMergedInto(e.target.value)} className={sel} aria-label="統合先">
                    <option value="">統合先（同じ美容師・店舗・種別の別の受付）</option>
                    {mergeCandidates.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                )}
              </>
            )}
            <label className="text-[12px] text-sub">運営の内部メモ（相手には見えません・2000字まで）
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} className="mt-1 min-h-24 w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13px]" />
            </label>
            <button type="button" disabled={busy} onClick={() => void save()} className={btn}>{busy ? "保存中..." : "保存する"}</button>
          </div>
        </section>
      )}

      {nexts.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-[13px] font-bold text-ink">担当を変更する</h2>
          <p className="mt-1 text-[11.5px] text-sub">現在の担当: {d.assigned_admin_id ? (d.assigned_admin_id === meId ? "自分" : "他の運営者") : "未割当"}</p>
          <div className="mt-3 grid gap-3">
            <select value={assignee} onChange={(e) => setAssignee(e.target.value as "me" | "none")} className={sel} aria-label="担当">
              <option value="me">自分が担当する</option>
              <option value="none">担当を外す（未割当）</option>
            </select>
            <button type="button" disabled={busy} onClick={() => void assign()} className={btn}>担当を変更する</button>
          </div>
        </section>
      )}

      {d.status === "post_visit_check" && (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-[13px] font-bold text-ink">実施後の確認を記録する</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-sub">サロンと本人の両方が「実施された」と確認できたら、状態を「実施済み」にできます。確認の方法（メッセージ・電話など）を記録します。</p>
          <div className="mt-3 grid gap-3">
            <select value={party} onChange={(e) => setParty(e.target.value as never)} className={sel} aria-label="確認した相手"><option value="salon">サロン</option><option value="stylist">本人（美容師）</option></select>
            <select value={result} onChange={(e) => setResult(e.target.value as never)} className={sel} aria-label="結果">{Object.entries(CONFIRM_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select value={channel} onChange={(e) => setChannel(e.target.value as never)} className={sel} aria-label="確認方法"><option value="message">メッセージ</option><option value="phone">電話</option><option value="other">その他</option></select>
            <textarea value={cnote} onChange={(e) => setCnote(e.target.value)} maxLength={1000} placeholder="メモ（任意）" className="min-h-16 w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13px]" />
            <button type="button" disabled={busy} onClick={() => void confirm()} className={btn}>確認を記録する</button>
          </div>
        </section>
      )}
      {msg && <p role="alert" className="rounded-lg bg-[#F5E9E9] px-3 py-2 text-[12px] text-[#8A2E2E]">{msg}</p>}
    </div>
  );
}
