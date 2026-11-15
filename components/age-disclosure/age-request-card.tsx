"use client";

import { useRef, useState } from "react";
import { respondAgeDisclosure } from "@/lib/age-disclosure/actions";
import type { AgeRequestDecision } from "@/types/database";

type Props = {
  requestId: string;
  storeName: string;
  location: string | null;
  requestedAt: string;
  decidedAt: string | null;
  status: AgeRequestDecision;
};

const STATUS_TEXT: Record<AgeRequestDecision, string> = {
  pending: "回答待ち",
  approved: "承認済み",
  declined: "辞退済み",
};

/** 実年齢の開示依頼の1件（美容師本人のみ）。承認すると、この店舗にだけ現在の満年齢が表示される。生年月日は公開されない。 */
export function AgeRequestCard({ requestId, storeName, location, requestedAt, decidedAt, status }: Props) {
  const [current, setCurrent] = useState<AgeRequestDecision>(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function respond(approve: boolean) {
    if (inFlight.current) return; // 連打しても1回だけ送る（DB側も二重処理を安全に扱う）
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const r = await respondAgeDisclosure({ requestId, approve });
    setBusy(false);
    inFlight.current = false;
    if (r.success) setCurrent(r.status);
    else setError(r.error);
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

  return (
    <article className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-[16px] font-bold text-ink">{storeName}</h2>
          {location && <p className="mt-0.5 text-[12px] text-sub">{location}</p>}
          <p className="mt-1 text-[11px] text-sub">{fmt(requestedAt)} に依頼</p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold ${current === "approved" ? "bg-[#37755B]/15 text-[#285B45]" : current === "declined" ? "bg-surface2 text-sub" : "bg-[#C98A1B]/15 text-[#7A5410]"}`}>
          {STATUS_TEXT[current]}
        </span>
      </div>

      {current === "pending" ? (
        <>
          <p className="mt-3 text-[12.5px] leading-relaxed text-charcoal">
            この店舗が、あなたの実年齢の開示を希望しています。承認すると、この店舗にだけ現在の満年齢が表示されます（誕生日のあとも最新の年齢）。生年月日は公開されません。辞退・未回答のあいだは、年代のままです。
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => void respond(false)} className="min-h-[44px] rounded-full border border-line px-4 py-2 text-[13px] font-semibold text-ink disabled:opacity-50">
              辞退する
            </button>
            <button type="button" disabled={busy} onClick={() => void respond(true)} className="min-h-[44px] rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-surface disabled:opacity-50">
              {busy ? "送信中..." : "承認する"}
            </button>
          </div>
        </>
      ) : (
        <p className="mt-3 text-[12px] leading-relaxed text-sub">
          {current === "approved" ? "この店舗にだけ、現在の満年齢を表示しています。" : "この店舗には、年代のまま表示しています。"}
          {decidedAt && `（${fmt(decidedAt)}）`}
          この回答は変更できません。
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-[12px] text-[#C24545]">{error}</p>}
    </article>
  );
}
