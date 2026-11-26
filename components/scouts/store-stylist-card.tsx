"use client";

import { useRef, useState } from "react";
import { makeRequestIdHolder } from "@/lib/billing/scout-send-rules";
import { sendStoreScout } from "@/lib/scouts/actions";
import { RECRUITING_PAUSED_MESSAGE } from "@/lib/contracts/recruiting-access";
import { SCOUT_TEMPLATES, SCOUT_RESPONSE_LABELS, type ScoutTemplateType } from "@/lib/scouts/options";
import { StylistPublicView } from "@/components/profile/stylist-public-view";
import { AgeRequestControl } from "@/components/age-disclosure/age-request-control";
import { formatAgeLabel } from "@/lib/profile/birth-date";
import { MATCH_AXIS_LABELS } from "@/lib/matching/types";
import type { StoreStylistMatchResult } from "@/lib/matching/types";
import type { PublicStylistForScout } from "@/lib/scouts/types";
import type { StoreScout } from "@/lib/store-activity/types";

// 直近の回答状況の表示に使う項目のみ（scoutsテーブルのRow・get_store_scoutsの行のどちらも渡せる）。
type LatestScout = Pick<StoreScout, "response_status" | "responded_at" | "response_message">;

type Props = {
  storeId: string;
  stylist: PublicStylistForScout;
  match: StoreStylistMatchResult | null;
  latestScout: LatestScout | null;
  /** 新しい採用活動を受け付けていない店舗か（trueなら新規Scoutの送信を止める。最終防衛はDB）。 */
  recruitingPaused?: boolean;
  /** スカウト送信・年齢開示依頼ができる権限か（閲覧のみの担当者は false。表示上のヒント。最終防衛はDBの can_manage_store_hiring）。 */
  canManage?: boolean;
  /** プロフィール画像の署名付きURL（サロン側で発行。画像が無い／取得できないときはnull）。 */
  avatarUrl?: string | null;
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
 *   - 残数は親ページ（ScoutQuotaCard、get_store_scout_quota）が表示する。
 *     送信自体はsend_scout_v2内部のquotaで保護され、枠超過時は専用の
 *     メッセージを表示する。
 */
export function StoreStylistCard({ storeId, stylist, match, latestScout, recruitingPaused = false, canManage = true, avatarUrl = null }: Props) {
  const [message, setMessage] = useState("");
  const [templateType, setTemplateType] = useState<ScoutTemplateType | null>(null);
  const [step, setStep] = useState<"compose" | "confirm-resend">("compose");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const hasPreviousScout = stylist.previous_scout_count > 0;
  const canSend = message.trim().length > 0 && !busy && !recruitingPaused;

  function pickTemplate(type: ScoutTemplateType) {
    setTemplateType(type);
    setMessage(SCOUT_TEMPLATES[type].text);
  }

  const requestIds = useRef(makeRequestIdHolder());

  async function doSend() {
    setBusy(true);
    setResult(null);
    const r = await sendStoreScout({ storeId, stylistUserId: stylist.stylist_user_id, message: message.trim(), templateType, requestId: requestIds.current.get(`${stylist.stylist_user_id}|${templateType}|${message.trim()}`) });
    if (r.success) requestIds.current.reset();
    setBusy(false);
    setStep("compose");
    setResult(r.success ? "スカウトを送信しました。" : r.error);
    if (r.success) setMessage("");
  }

  function handleSendClick() {
    if (recruitingPaused) return;
    if (hasPreviousScout) setStep("confirm-resend");
    else void doSend();
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <StylistPublicView
            data={{
              publicName: stylist.public_name,
              prefecture: stylist.prefecture,
              currentPosition: stylist.current_position,
              experienceYears: stylist.experience_years,
              desiredWorkLocation: stylist.desired_work_location,
              jobChangeIntent: stylist.job_change_intent,
              specialties: stylist.specialties,
              bio: stylist.bio,
              // 0070適用後のRPCだけが返す項目。キーが無い（未適用）ときは従来の項目だけを表示する。
              extended: "employment_type" in stylist,
              avatarUrl,
              employmentType: stylist.employment_type ?? null,
              instagramHandle: stylist.instagram_handle ?? null,
              valuePriorities: stylist.value_priorities ?? null,
              ageLabel: formatAgeLabel(stylist),
            }}
          />
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

      <AgeRequestControl storeId={storeId} stylistUserId={stylist.stylist_user_id} status={stylist.age_request_status} recruitingPaused={recruitingPaused} canManage={canManage} />

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

      {!canManage ? (
        <p className="mt-4 rounded-lg bg-surface2 px-3 py-2 text-[11.5px] leading-relaxed text-sub">
          閲覧のみの権限のため、スカウトは送れません。送信が必要な場合は、店長・採用担当・管理者にご依頼ください。
        </p>
      ) : (
      <div className="mt-4 border-t border-line pt-4">
        <p className="eyebrow mb-2">スカウトを送る</p>

        {recruitingPaused && (
          <p className="mb-2 text-[11.5px] leading-relaxed text-sub">{RECRUITING_PAUSED_MESSAGE}</p>
        )}

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
      )}
    </div>
  );
}
