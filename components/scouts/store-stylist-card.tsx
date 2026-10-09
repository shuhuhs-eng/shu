"use client";

import { useState } from "react";
import { sendStoreScout } from "@/lib/scouts/actions";
import { SCOUT_TEMPLATES, SCOUT_RESPONSE_LABELS, type ScoutTemplateType } from "@/lib/scouts/options";
import { JOB_CHANGE_INTENT_LABELS } from "@/lib/validation/profile-options";
import { MATCH_AXIS_LABELS } from "@/lib/matching/types";
import type { StoreStylistMatchResult } from "@/lib/matching/types";
import type { PublicStylistForScout } from "@/lib/scouts/types";
import type { Database } from "@/types/database";

type LatestScout = Database["public"]["Tables"]["scouts"]["Row"];

type Props = {
  storeId: string;
  stylist: PublicStylistForScout;
  match: StoreStylistMatchResult | null;
  latestScout: LatestScout | null;
};

/**
 * 店舗単位「美容師を探す」一覧カード（/salon/stores/[storeId]/stylists専用、
 * 法人・複数店舗対応 Phase 5）。
 *
 * ★既存components/scouts/salon-stylist-card.tsxのUX（テンプレート・
 * 再スカウト確認・8軸折りたたみ・直近の回答状況表示）をできるだけ維持する。
 * 差分は以下のみ:
 *   - 相性は親から渡されるStoreStylistMatchResult（calculate_store_stylist_match
 *     基準）を使う。stylist.match（get_public_stylists_for_scoutが返す旧
 *     salon_user_id基準の相性）は一切使わない。
 *   - 送信はsendStoreScout（send_scout_v2）のみ。storeIdは親から渡された
 *     値をそのまま使う（推測しない）。
 *   - quota残数の事前表示は行わない（今回は未接続。送信自体は
 *     send_scout_v2内部のorganization quotaで保護される）。枠超過時は
 *     RPCからのエラーメッセージをそのまま表示する。
 */
export function StoreStylistCard({ storeId, stylist, match, latestScout }: Props) {
  const [message, setMessage] = useState("");
  const [templateType, setTemplateType] = useState<ScoutTemplateType | null>(null);
  const [step, setStep] = useState<"compose" | "confirm-resend">("compose");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const hasPreviousScout = stylist.previous_scout_count > 0;
  const canSend = message.trim().length > 0 && !busy;

  function pickTemplate(type: ScoutTemplateType) {
    setTemplateType(type);
    setMessage(SCOUT_TEMPLATES[type].text);
  }

  async function doSend() {
    setBusy(true);
    setResult(null);
    const r = await sendStoreScout({ storeId, stylistUserId: stylist.stylist_user_id, message: message.trim(), templateType });
    setBusy(false);
    setStep("compose");
    setResult(r.success ? "スカウトを送信しました。" : r.error);
    if (r.success) setMessage("");
  }

  function handleSendClick() {
    if (hasPreviousScout) setStep("confirm-resend");
    else void doSend();
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-[17px] font-bold text-ink">{stylist.public_name ?? "美容師"}</h3>
          <p className="mt-1 text-[12.5px] text-sub">
            {[stylist.prefecture, stylist.current_position].filter(Boolean).join(" / ") || "プロフィール情報未設定"}
          </p>
        </div>
        {match?.available && (
          <div className="shrink-0 rounded-full px-3 py-1.5 text-center" style={{ backgroundColor: "#EAF3EC" }}>
            <p className="text-[10px] font-semibold text-sub">相性</p>
            <p className="text-[18px] font-bold leading-none" style={{ color: "#2E8B7F" }}>
              {match.overall_score}%
            </p>
          </div>
        )}
      </div>

      {stylist.experience_years != null && <p className="mt-2 text-[12px] text-sub">経験{stylist.experience_years}年</p>}
      {stylist.desired_work_location && <p className="mt-1 text-[12.5px] text-charcoal">希望勤務地: {stylist.desired_work_location}</p>}
      <p className="mt-1 text-[12.5px] text-charcoal">{JOB_CHANGE_INTENT_LABELS[stylist.job_change_intent]}</p>

      {stylist.specialties.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {stylist.specialties.map((s) => (
            <span key={s} className="rounded-full border border-line bg-surface2 px-2.5 py-1 text-[11px] text-charcoal">
              {s}
            </span>
          ))}
        </div>
      )}

      {stylist.bio && <p className="mt-3 text-[12.5px] leading-relaxed text-charcoal">{stylist.bio}</p>}

      {match?.available && (
        <details className="mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer text-[12.5px] font-semibold text-ink underline">8つの軸で見る</summary>
          <ul className="mt-3 space-y-2">
            {(Object.keys(MATCH_AXIS_LABELS) as (keyof typeof MATCH_AXIS_LABELS)[]).map((key) => (
              <li key={key} className="flex items-center justify-between gap-3 text-[12.5px] text-charcoal">
                <span>{MATCH_AXIS_LABELS[key]}</span>
                <span className="font-semibold text-ink">{match.axis_scores?.[key]}%</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {(stylist.previous_interest_at || hasPreviousScout) && (
        <div className="mt-4 rounded-lg border border-line bg-surface2 p-3 text-[11.5px] text-charcoal">
          {stylist.previous_interest_at && <p>以前この美容師からアプローチを受けています。</p>}
          {hasPreviousScout && (
            <p className="mt-1">
              以前この美容師へスカウトしています（{stylist.previous_scout_count}回
              {stylist.previous_scout_last_sent_at && `・最終送信: ${new Date(stylist.previous_scout_last_sent_at).toLocaleDateString("ja-JP")}`}）
            </p>
          )}
          {latestScout && (
            <p className="mt-1 font-semibold text-ink">
              直近の回答状況: {SCOUT_RESPONSE_LABELS[latestScout.response_status] ?? latestScout.response_status}
              {latestScout.responded_at && `（${new Date(latestScout.responded_at).toLocaleString("ja-JP")}）`}
            </p>
          )}
          {latestScout?.response_status === "question" && latestScout.response_message && (
            <p className="mt-1 rounded-md bg-surface px-2.5 py-2 font-normal text-charcoal">
              {latestScout.response_message}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 border-t border-line pt-4">
        <p className="eyebrow mb-2">スカウトを送る</p>

        {step === "compose" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => pickTemplate("casual")} className="rounded-full border border-line py-2 text-[11px]">
                {SCOUT_TEMPLATES.casual.label}
              </button>
              <button type="button" onClick={() => pickTemplate("concrete")} className="rounded-full border border-line py-2 text-[11px]">
                {SCOUT_TEMPLATES.concrete.label}
              </button>
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
              placeholder="スカウトメッセージ（テンプレートを選ぶと文面が入ります。自由に編集できます）"
              className="mt-2 min-h-28 w-full rounded-lg border border-line px-3 py-2 text-[12px]"
            />
            <button
              type="button"
              disabled={!canSend}
              onClick={handleSendClick}
              className="mt-2 flex w-full items-center justify-center rounded-full bg-ink px-6 py-3 text-[13px] font-semibold text-surface disabled:opacity-50"
            >
              スカウトを送る
            </button>
          </>
        )}

        {step === "confirm-resend" && (
          <div>
            <p className="text-[12.5px] font-semibold text-charcoal">
              以前この美容師へスカウトを送っています（{stylist.previous_scout_count}回）。もう一度スカウトを送りますか？
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" disabled={busy} onClick={() => setStep("compose")} className="rounded-full border border-line py-2 text-[12px]">
                戻る
              </button>
              <button type="button" disabled={busy} onClick={() => void doSend()} className="rounded-full bg-ink py-2 text-[12px] font-semibold text-surface">
                {busy ? "送信中..." : "送信する"}
              </button>
            </div>
          </div>
        )}

        {result && <p className="mt-2 text-[11.5px] text-charcoal">{result}</p>}
      </div>
    </div>
  );
}
