"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateHiringStatusAction } from "@/lib/hiring/actions";
import {
  HIRING_REASON_LABELS,
  HIRING_STATUS_LABELS,
  allowedNextStatuses,
  isHiringReasonCode,
  statusActionLabel,
} from "@/lib/hiring/format";
import { RECRUITING_PAUSED_MESSAGE } from "@/lib/contracts/recruiting-access";
import type { HiringReasonCode, HiringStatus } from "@/lib/hiring/types";

type Props = {
  storeId: string;
  processId: string;
  currentStatus: string;
  /** 新しい採用活動を受け付けていない店舗か（辞退・不採用からの選考再開だけを止める）。 */
  recruitingPaused?: boolean;
  /** 新しい採用契約（0109・提案）が開かれている（辞退・取消でない）採用か。true のとき、旧方式の「採用にする」は出さない（採用確定は内定カードの操作で行う。二重請求の防止）。 */
  hireAgreementLive?: boolean;
  /** 新機能が有効なのに契約情報を取得できなかった。「契約なし」と同じに扱わず、採用確定の操作を止めて再取得を案内する。 */
  hireAgreementUnknown?: boolean;
};

// 面談予定は面談フォーム側、「内定」(offered)は廃止のため、ここでは選べない。
type TargetStatus = Exclude<HiringStatus, "interview_scheduled" | "offered">;

/**
 * ステータス変更パネル。現在の状態から移動できる候補だけを表示する
 * （面談予定への変更は日時が要るため、面談フォーム側で行う）。
 * 採用確定(hired)後は候補が空になり、何も表示しない。
 */
export function StatusPanel({ storeId, processId, currentStatus, recruitingPaused = false, hireAgreementLive = false, hireAgreementUnknown = false }: Props) {
  const router = useRouter();
  // 辞退・不採用から連絡調整中へ戻す再開は「新しい採用活動の再開」なので、停止中の店舗では出さない
  // （DBのguardと同じ。面談・選考・採用・辞退・不採用などの既存の進行は止めない）。
  const isReopenBlocked = recruitingPaused && (currentStatus === "declined" || currentStatus === "rejected");
  const targets = allowedNextStatuses(currentStatus).filter(
    (s): s is TargetStatus => s !== "interview_scheduled" && s !== "offered" && !(isReopenBlocked && s === "contacting") && !((hireAgreementLive || hireAgreementUnknown) && s === "hired"),
  );
  const [selected, setSelected] = useState<TargetStatus | null>(null);
  const [publicNote, setPublicNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [reasonCode, setReasonCode] = useState<HiringReasonCode | "">("");
  const [reasonNote, setReasonNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unknownNote = hireAgreementUnknown && !hireAgreementLive ? (
    <p data-testid="hire-unknown-note" role="alert" className="mt-3 rounded-lg bg-surface2 px-3 py-2 text-[11px] leading-relaxed text-[#8A2E2E]">
      入社の確認（採用契約）の情報を取得できなかったため、<b>採用の確定は一時的に止めています</b>。画面を読み込み直してください（「契約なし」と判断したわけではありません）。
    </p>
  ) : null;
  const liveNote = hireAgreementLive ? (
    <p data-testid="hire-live-note" className="mt-3 rounded-lg bg-surface2 px-3 py-2 text-[11px] leading-relaxed text-sub">
      この採用には採用契約（入社の確認・採用料の請求予定）が開かれています。<b>採用の確定は、上の「入社の確認」の操作で行います</b>（ここで「採用にする」を行うと、旧方式の成功報酬と二重になるため表示していません）。辞退・不採用にした場合は、運営が契約を辞退・取消に整理するまで、採用料の自動請求は開始されません。
    </p>
  ) : null;
  if (targets.length === 0 && hireAgreementUnknown && !hireAgreementLive) return <div className="rounded-xl border border-line bg-surface p-4"><p className="text-[12px] font-bold text-ink">ステータスを変更</p>{unknownNote}</div>;
  if (targets.length === 0 && hireAgreementLive) return <div className="rounded-xl border border-line bg-surface p-4"><p className="text-[12px] font-bold text-ink">ステータスを変更</p>{liveNote}</div>;
  if (targets.length === 0) {
    return isReopenBlocked ? (
      <p className="rounded-lg bg-surface2 px-3 py-2 text-[11px] leading-relaxed text-sub">
        {RECRUITING_PAUSED_MESSAGE}。選考を再開することはできません。
      </p>
    ) : null;
  }

  const needsReason = selected === "declined" || selected === "rejected";

  function reset() {
    setSelected(null);
    setPublicNote("");
    setInternalNote("");
    setReasonCode("");
    setReasonNote("");
    setConfirmOpen(false);
    setError(null);
  }

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const result = await updateHiringStatusAction({
      storeId,
      processId,
      toStatus: selected,
      publicNote,
      internalNote,
      reasonCode: needsReason ? reasonCode : "",
      reasonNote: needsReason ? reasonNote : "",
    });
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    reset();
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-[12px] font-bold text-ink">ステータスを変更</p>

      {liveNote}{unknownNote}
      <div className="mt-3 flex flex-wrap gap-2">
        {targets.map((target) => (
          <button
            key={target}
            type="button"
            onClick={() => {
              reset();
              setSelected(target);
            }}
            className={`rounded-full border px-3 py-2 text-[11.5px] font-semibold ${
              selected === target ? "border-ink bg-ink text-surface" : "border-line bg-surface text-charcoal"
            }`}
          >
            {statusActionLabel(currentStatus, target)}
          </button>
        ))}
      </div>

      {selected && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-[12px] text-charcoal">
            「{HIRING_STATUS_LABELS[selected]}」に変更します。
          </p>

          {selected === "hired" && (
            <p className="mt-3 rounded-lg bg-[#C24545]/10 p-3 text-[11px] leading-relaxed text-[#8A2E2E]">
              採用を確定すると、成功報酬の請求対象になります。あとから元に戻したり確定日時を変更したりできません。
            </p>
          )}

          {needsReason && (
            <>
              <label className="mt-3 block text-[11px] text-charcoal">
                理由（社内の記録用・美容師には表示されません）
                <select
                  value={reasonCode}
                  onChange={(e) => setReasonCode(isHiringReasonCode(e.target.value) ? e.target.value : "")}
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2"
                >
                  <option value="">選択しない</option>
                  {Object.entries(HIRING_REASON_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-3 block text-[11px] text-charcoal">
                理由のメモ（社内のみ）
                <textarea
                  value={reasonNote}
                  onChange={(e) => setReasonNote(e.target.value)}
                  maxLength={1000}
                  className="mt-1 min-h-14 w-full rounded-lg border border-line px-3 py-2 text-[12px]"
                />
              </label>
            </>
          )}

          <label className="mt-3 block text-[11px] text-charcoal">
            美容師への案内（任意・美容師に表示されます）
            <textarea
              value={publicNote}
              onChange={(e) => setPublicNote(e.target.value)}
              maxLength={1000}
              className="mt-1 min-h-14 w-full rounded-lg border border-line px-3 py-2 text-[12px]"
            />
          </label>
          <label className="mt-3 block text-[11px] text-charcoal">
            社内メモ（任意・美容師には表示されません）
            <textarea
              value={internalNote}
              onChange={(e) => setInternalNote(e.target.value)}
              maxLength={2000}
              className="mt-1 min-h-14 w-full rounded-lg border border-line px-3 py-2 text-[12px]"
            />
          </label>

          {error && <p className="mt-3 text-[11px] text-[#8A2E2E]">{error}</p>}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => (selected === "hired" ? setConfirmOpen(true) : submit())}
              disabled={busy}
              className="flex-1 rounded-full bg-ink px-4 py-3 text-[12px] font-bold text-surface disabled:opacity-50"
            >
              {busy ? "保存しています…" : selected === "hired" ? "採用にする" : "変更する"}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="rounded-full border border-line px-4 py-3 text-[12px] text-sub"
            >
              やめる
            </button>
          </div>
        </div>
      )}

      {confirmOpen && selected === "hired" && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="hire-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-5"
        >
          <div className="w-full max-w-[360px] rounded-2xl bg-surface p-5 shadow-xl">
            <p id="hire-confirm-title" className="font-serif text-[16px] font-bold text-ink">
              この美容師を採用にしますか？
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-charcoal">
              採用を確定すると成功報酬の請求対象になります。
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={busy}
                className="flex-1 rounded-full border border-line px-4 py-3 text-[12px] font-semibold text-sub"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="flex-1 rounded-full bg-ink px-4 py-3 text-[12px] font-bold text-surface disabled:opacity-50"
              >
                {busy ? "確定しています…" : "採用を確定"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
