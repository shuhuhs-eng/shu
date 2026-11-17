"use client";

import { useRef, useState } from "react";
import { requestAgeDisclosure } from "@/lib/age-disclosure/actions";
import type { AgeRequestStatus } from "@/types/database";

type Props = {
  storeId: string;
  stylistUserId: string;
  /** サロン向けレスポンスの age_request_status。未対応のDB（キー無し）や unavailable / not_needed のときは何も表示しない。 */
  status: AgeRequestStatus | undefined;
  /** 新しい採用活動を受け付けていない店舗（新規の依頼を止める。最終防衛はDB）。 */
  recruitingPaused?: boolean;
  /** 依頼ができる権限か（閲覧のみの担当者は false。表示上のヒント。最終防衛はDBの can_manage_store_hiring）。 */
  canManage?: boolean;
};

/**
 * 「実年齢の開示を依頼」（任意）。年代で表示している美容師にだけ出る。
 * ・依頼しても自動では開示されない。美容師が承認した場合に、この店舗にだけ現在の満年齢が表示される。
 * ・連打しても1件だけ（ボタンは送信中に無効化し、DB側も同じ依頼を返す）。
 */
export function AgeRequestControl({ storeId, stylistUserId, status, recruitingPaused = false, canManage = true }: Props) {
  const [current, setCurrent] = useState<AgeRequestStatus | undefined>(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  if (current === undefined || current === "unavailable" || current === "not_needed") return null;

  async function send() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const r = await requestAgeDisclosure({ storeId, stylistUserId });
    setBusy(false);
    inFlight.current = false;
    if (r.success) setCurrent(r.status === "approved" ? "approved" : r.status === "declined" ? "declined" : "pending");
    else setError(r.error);
  }

  return (
    <div className="mt-3 rounded-lg border border-line bg-surface2 px-3 py-2.5 text-[11.5px] leading-relaxed text-charcoal">
      {current === "none" && (
        <>
          <p>この美容師は年代で表示しています。必要な場合は、実年齢の開示を依頼できます（任意）。承認された場合のみ、この店舗に実年齢が表示されます。</p>
          <button
            type="button"
            disabled={busy || recruitingPaused || !canManage}
            onClick={() => void send()}
            className="mt-2 flex min-h-[40px] w-full items-center justify-center rounded-full border border-ink px-4 py-2 text-[12px] font-semibold text-ink disabled:opacity-50"
          >
            {busy ? "依頼中..." : "実年齢の開示を依頼"}
          </button>
          {recruitingPaused && <p className="mt-1 text-sub">現在、新しい依頼は受け付けていません。</p>}
          {!canManage && <p className="mt-1 text-sub">閲覧のみの権限のため、依頼はできません。</p>}
        </>
      )}
      {current === "pending" && <p className="font-semibold text-ink">実年齢の開示を依頼中です（美容師の回答待ち）。回答があるまで年代のまま表示されます。</p>}
      {current === "approved" && <p className="font-semibold text-ink">実年齢の開示が承認されています（この店舗にのみ表示）。</p>}
      {current === "declined" && <p>実年齢の開示は辞退されました。年代のまま表示されます。</p>}
      {error && <p role="alert" className="mt-1 text-[#C24545]">{error}</p>}
    </div>
  );
}
