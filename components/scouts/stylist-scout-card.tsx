"use client";

import { useState } from "react";
import { markScoutRead, respondScout } from "@/lib/scouts/actions";
import { SCOUT_RESPONSE_LABELS } from "@/lib/scouts/options";
import type { Database } from "@/types/database";

type Scout = Database["public"]["Tables"]["scouts"]["Row"];

type Props = { scout: Scout; salonName: string; history: Scout[] };

/**
 * 美容師側「届いたスカウト」カード（1サロン1カード方針）。
 * components/salary-offers/stylist-offer-card.tsxと同じ構造:
 *   ・そのサロンの最新スカウト(scout)のみを回答対象として表示する。
 *   ・過去のスカウト(history)は折りたたみ内に読み取り専用で表示するだけで、
 *     回答ボタンは一切出さない。
 *   ・回答は二段階方式（最初のクリックでは確定させず、確認状態を経てから
 *     初めてrespondScoutを呼ぶ。「戻る」は送信前のUI状態を選択肢へ戻す
 *     だけで、DB状態には一切影響しない）。
 *
 * ★read_status（開封）とresponse_status（回答）は別軸。未読の場合は
 * 「スカウト内容を見る」を挟み、そこでmarkScoutReadを呼んで初めて
 * メッセージ本文・回答UIを表示する（開封=既読の唯一のトリガー）。
 * 既読済みのスカウトは最初から内容を開いた状態で表示する。
 */
export function StylistScoutCard({ scout, salonName, history }: Props) {
  const [current, setCurrent] = useState(scout);
  const [expanded, setExpanded] = useState(scout.read_status === "read");
  const [opening, setOpening] = useState(false);
  const [step, setStep] = useState<"choice" | "interested" | "question" | "considering" | "declined">("choice");
  const [responseMessage, setResponseMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function openCard() {
    if (expanded) return;
    setOpening(true);
    if (current.read_status === "unread") {
      const r = await markScoutRead({ scoutId: current.id });
      if (r.success) setCurrent((c) => ({ ...c, read_status: "read", read_at: c.read_at ?? new Date().toISOString() }));
    }
    setOpening(false);
    setExpanded(true);
  }

  async function answer(response: "interested" | "question" | "considering" | "declined") {
    setBusy(true);
    setMsg(null);
    const r = await respondScout({
      scoutId: current.id,
      response,
      responseMessage: response === "question" ? responseMessage.trim() || null : null,
    });
    setBusy(false);
    if (r.success) {
      setCurrent((c) => ({ ...c, response_status: response, response_message: response === "question" ? responseMessage.trim() || null : null }));
      setMsg("回答を送信しました。");
    } else {
      setMsg(r.error);
    }
  }

  return (
    <article className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="eyebrow mb-1">スカウト</p>
          <h3 className="font-serif text-lg font-bold text-ink">{salonName}</h3>
        </div>
        {current.read_status === "unread" && <span className="rounded-full bg-[#C24545] px-2.5 py-1 text-[10px] font-bold text-white">未読</span>}
      </div>
      <p className="mt-1 text-[11px] text-sub">{new Date(current.sent_at).toLocaleString("ja-JP")} 受信</p>
      {current.matching_score != null && <p className="mt-1 text-[11.5px] text-sub">相性 {current.matching_score}%</p>}
      {history.length > 0 && (
        <p className="mt-2 rounded-lg bg-surface2 px-3 py-2 text-[11.5px] text-charcoal">
          以前このサロンからスカウトを受けています（{history.length}回）。
        </p>
      )}

      {!expanded ? (
        <button type="button" disabled={opening} onClick={() => void openCard()} className="mt-4 flex w-full items-center justify-center rounded-full border border-line bg-surface2 px-6 py-3 text-[13px] font-semibold text-ink">
          {opening ? "開いています..." : "スカウト内容を見る"}
        </button>
      ) : (
        <>
          <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-charcoal">{current.message}</p>

          {current.response_status === "no_response" && (
            <>
              {step === "choice" && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button disabled={busy} onClick={() => setStep("interested")} className="rounded-full bg-[#285B45] py-2 text-[11px] font-bold text-white">話を聞いてみたい</button>
                  <button disabled={busy} onClick={() => setStep("question")} className="rounded-full border border-line py-2 text-[11px]">条件をもう少し知りたい</button>
                  <button disabled={busy} onClick={() => setStep("considering")} className="rounded-full border border-line py-2 text-[11px]">今は検討中</button>
                  <button disabled={busy} onClick={() => setStep("declined")} className="rounded-full border border-line py-2 text-[11px] text-sub">今回は見送る</button>
                </div>
              )}
              {step === "interested" && (
                <div className="mt-4">
                  <p className="text-[12px] font-semibold text-charcoal">「話を聞いてみたい」を送りますか？</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button disabled={busy} onClick={() => setStep("choice")} className="rounded-full border border-line py-2 text-[11px]">戻る</button>
                    <button disabled={busy} onClick={() => void answer("interested")} className="rounded-full bg-[#285B45] py-2 text-[11px] font-bold text-white">{busy ? "送信中..." : "送信する"}</button>
                  </div>
                </div>
              )}
              {step === "question" && (
                <div className="mt-4">
                  <textarea value={responseMessage} onChange={(e) => setResponseMessage(e.target.value)} maxLength={1000} placeholder="知りたい内容を入力してください" className="min-h-20 w-full rounded-lg border border-line px-3 py-2 text-[11px]" />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button disabled={busy} onClick={() => setStep("choice")} className="rounded-full border border-line py-2 text-[11px]">戻る</button>
                    <button disabled={busy || responseMessage.trim().length === 0} onClick={() => void answer("question")} className="rounded-full bg-ink py-2 text-[11px] font-bold text-surface disabled:opacity-50">{busy ? "送信中..." : "送信する"}</button>
                  </div>
                </div>
              )}
              {step === "considering" && (
                <div className="mt-4">
                  <p className="text-[12px] font-semibold text-charcoal">「今は検討中」を送りますか？</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button disabled={busy} onClick={() => setStep("choice")} className="rounded-full border border-line py-2 text-[11px]">戻る</button>
                    <button disabled={busy} onClick={() => void answer("considering")} className="rounded-full bg-ink py-2 text-[11px] font-bold text-surface">{busy ? "送信中..." : "送信する"}</button>
                  </div>
                </div>
              )}
              {step === "declined" && (
                <div className="mt-4">
                  <p className="text-[12px] font-semibold text-charcoal">今回は見送りますか？</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button disabled={busy} onClick={() => setStep("choice")} className="rounded-full border border-line py-2 text-[11px]">戻る</button>
                    <button disabled={busy} onClick={() => void answer("declined")} className="rounded-full border border-[#8A2E2E]/30 py-2 text-[11px] font-bold text-[#8A2E2E]">{busy ? "送信中..." : "見送る"}</button>
                  </div>
                </div>
              )}
            </>
          )}

          {current.response_status !== "no_response" && (
            <p className="mt-3 text-[11px] font-semibold text-sub">
              回答済み: {SCOUT_RESPONSE_LABELS[current.response_status] ?? current.response_status}
              {current.response_message && <span className="mt-1 block font-normal text-charcoal">{current.response_message}</span>}
            </p>
          )}
          {msg && <p className="mt-2 text-[11px] text-charcoal">{msg}</p>}
        </>
      )}

      {history.length > 0 && (
        <details className="mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer text-[11px] font-semibold text-sub underline">過去のスカウトを見る（{history.length}件）</summary>
          <div className="mt-3 space-y-2">
            {history.map((past) => (
              <div key={past.id} className="rounded-lg border border-line bg-surface2 p-3 text-[11px] text-charcoal">
                <p className="text-[10px] text-sub">{new Date(past.sent_at).toLocaleString("ja-JP")} 受信</p>
                <p className="mt-1 whitespace-pre-wrap">{past.message}</p>
                <p className="mt-1 font-semibold">回答: {SCOUT_RESPONSE_LABELS[past.response_status] ?? past.response_status}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}
