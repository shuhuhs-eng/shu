"use client";

import { useState } from "react";
import { sendScout } from "@/lib/scouts/actions";
import { SCOUT_TEMPLATES, type ScoutTemplateType } from "@/lib/scouts/options";
import { JOB_CHANGE_INTENT_LABELS } from "@/lib/validation/profile-options";
import { MATCH_AXIS_LABELS } from "@/lib/matching/types";
import type { PublicStylistForScout } from "@/lib/scouts/types";

type Props = { stylist: PublicStylistForScout; remainingQuota: number };

/**
 * サロン側「美容師を探す」一覧カード（/salon/stylists専用）。
 *
 * ★デザインはcomponents/stylist-salons/salon-card.tsxの相性%バッジ・
 * <details>による8軸折りたたみパターンを踏襲している。
 *
 * ★再スカウト確認: previous_scout_countが1件以上ある場合、送信ボタンを
 * 押しても即送信せず、一度「以前スカウトしています。もう一度送りますか？」
 * という確認ステップを挟む（confirm-resend）。過去のやり取りが無い場合は
 * 確認なしで送信できる。
 *
 * ★テンプレートはあくまで文面の出発点。ボタンを押すとテキストエリアに
 * テンプレート文を挿入するだけで、送信前に自由に編集できる。実際に
 * 送信されるのはテキストエリアの最終的な内容（message）。
 */
export function SalonStylistCard({ stylist, remainingQuota }: Props) {
  const [message, setMessage] = useState("");
  const [templateType, setTemplateType] = useState<ScoutTemplateType | null>(null);
  const [step, setStep] = useState<"compose" | "confirm-resend">("compose");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const quotaExhausted = remainingQuota <= 0;
  const hasPreviousScout = stylist.previous_scout_count > 0;
  const canSend = message.trim().length > 0 && !quotaExhausted && !busy;

  function pickTemplate(type: ScoutTemplateType) {
    setTemplateType(type);
    setMessage(SCOUT_TEMPLATES[type].text);
  }

  async function doSend() {
    setBusy(true);
    setResult(null);
    const r = await sendScout({ stylistUserId: stylist.stylist_user_id, message: message.trim(), templateType });
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
        {stylist.match.available && (
          <div className="shrink-0 rounded-full px-3 py-1.5 text-center" style={{ backgroundColor: "#EAF3EC" }}>
            <p className="text-[10px] font-semibold text-sub">相性</p>
            <p className="text-[18px] font-bold leading-none" style={{ color: "#2E8B7F" }}>
              {stylist.match.overall_score}%
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

      {stylist.match.available && (
        <details className="mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer text-[12.5px] font-semibold text-ink underline">8つの軸で見る</summary>
          <ul className="mt-3 space-y-2">
            {(Object.keys(MATCH_AXIS_LABELS) as (keyof typeof MATCH_AXIS_LABELS)[]).map((key) => (
              <li key={key} className="flex items-center justify-between gap-3 text-[12.5px] text-charcoal">
                <span>{MATCH_AXIS_LABELS[key]}</span>
                <span className="font-semibold text-ink">{stylist.match.axis_scores?.[key]}%</span>
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
        </div>
      )}

      <div className="mt-4 border-t border-line pt-4">
        <p className="eyebrow mb-2">スカウトを送る</p>

        {quotaExhausted && (
          <p className="mb-3 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[11.5px] leading-relaxed text-[#8A2E2E]">
            今月のスカウト枠を使い切りました。追加スカウト購入機能は準備中です。
          </p>
        )}

        {step === "compose" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={quotaExhausted} onClick={() => pickTemplate("casual")} className="rounded-full border border-line py-2 text-[11px] disabled:opacity-50">
                {SCOUT_TEMPLATES.casual.label}
              </button>
              <button type="button" disabled={quotaExhausted} onClick={() => pickTemplate("concrete")} className="rounded-full border border-line py-2 text-[11px] disabled:opacity-50">
                {SCOUT_TEMPLATES.concrete.label}
              </button>
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
              disabled={quotaExhausted}
              placeholder="スカウトメッセージ（テンプレートを選ぶと文面が入ります。自由に編集できます）"
              className="mt-2 min-h-28 w-full rounded-lg border border-line px-3 py-2 text-[12px] disabled:opacity-50"
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
