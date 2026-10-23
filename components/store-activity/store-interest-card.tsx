import { SalonOfferForm } from "@/components/salary-offers/salon-offer-form";
import { JOB_CHANGE_INTENT_LABELS } from "@/lib/validation/profile-options";
import { CAREER_GOAL_LABELS, type CareerGoalCode } from "@/lib/match-profile/options";
import { formatJstDateTime } from "@/lib/store-activity/format";
import type { StoreReceivedInterest, StoreSalaryOffer } from "@/lib/store-activity/types";

type Props = {
  storeId: string;
  interest: StoreReceivedInterest;
  /** この美容師へ、この店舗から出した最新の給与オファー（無ければnull）。 */
  latestOffer: StoreSalaryOffer | null;
  /** 新しい採用活動を受け付けていない店舗か（給与オファーの新規作成を止める）。 */
  recruitingPaused?: boolean;
};

const VERIFICATION_LABELS: Record<string, string> = {
  self_reported: "自己申告",
  submitted: "資料提出済み・確認中",
  needs_review: "数字の確認が必要",
  verified: "提出資料確認済み",
  reverification_needed: "実績変更のため再確認が必要",
  rejected: "資料再提出が必要",
};

/**
 * 「話を聞いてみたい」を送ってくれた美容師のカード（店舗側、store単位）。
 * 表示内容は旧マイページの受信カードと同じ考え方で、店舗単位の相性を加える。
 * 給与オファーのフォームは、DB側(create_salary_offer_v2)の条件と同じ
 * 「実績に基づくオファーを希望」かつ「提出資料の確認済み」の美容師にだけ表示する。
 */
export function StoreInterestCard({ storeId, interest, latestOffer, recruitingPaused = false }: Props) {
  const mp = interest.match_profile;
  const match = interest.match;
  const canOffer = !!mp && mp.wants_performance_offer && mp.verification_status === "verified";

  return (
    <article className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-[16px] font-bold text-ink">{interest.public_name ?? "美容師"}</h3>
          <p className="mt-1 text-[12px] text-sub">
            {[interest.prefecture, interest.current_position].filter(Boolean).join(" / ") ||
              "プロフィール情報未設定"}
          </p>
          <p className="mt-1 text-[10.5px] text-sub">{formatJstDateTime(interest.created_at)} に送信</p>
        </div>
        <div className="shrink-0 text-right">
          {match.available && match.overall_score != null ? (
            <div className="rounded-full px-3 py-1.5 text-center" style={{ backgroundColor: "#EAF3EC" }}>
              <p className="text-[10px] font-semibold text-sub">相性</p>
              <p className="text-[18px] font-bold leading-none" style={{ color: "#2E8B7F" }}>
                {match.overall_score}%
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-sub">相性診断準備中</p>
          )}
          {interest.experience_years != null && (
            <p className="mt-1 text-[12px] text-sub">経験{interest.experience_years}年</p>
          )}
        </div>
      </div>

      {interest.desired_work_location && (
        <p className="mt-3 text-[12.5px] text-charcoal">希望勤務地: {interest.desired_work_location}</p>
      )}
      <p className="mt-1 text-[12.5px] text-charcoal">{JOB_CHANGE_INTENT_LABELS[interest.job_change_intent]}</p>

      {mp && (
        <div className="mt-4 rounded-xl border border-line bg-surface2 p-4">
          <p className="eyebrow mb-1">一番変えたいこと</p>
          <p className="text-[13px] font-bold text-ink">
            {CAREER_GOAL_LABELS[mp.primary_goal as CareerGoalCode] ?? mp.primary_goal}
          </p>
          {mp.secondary_goals.length > 0 && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-sub">
              ほかに重視:{" "}
              {mp.secondary_goals.map((goal) => CAREER_GOAL_LABELS[goal as CareerGoalCode] ?? goal).join(" / ")}
            </p>
          )}

          {mp.wants_performance_offer && (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-[11px] font-bold ${
                    mp.verification_status === "verified"
                      ? "bg-[#37755B]/15 text-[#285B45]"
                      : mp.verification_status === "needs_review" ||
                          mp.verification_status === "rejected" ||
                          mp.verification_status === "reverification_needed"
                        ? "bg-[#C24545]/10 text-[#8A2E2E]"
                        : "bg-surface text-sub"
                  }`}
                >
                  {VERIFICATION_LABELS[mp.verification_status] ?? "自己申告"}
                </span>
                {mp.evidence_document_count > 0 && (
                  <span className="text-[10.5px] text-sub">証明資料 {mp.evidence_document_count}件</span>
                )}
              </div>
              {mp.consistency_issues.length > 0 && (
                <p className="mt-2 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[10.5px] leading-relaxed text-[#8A2E2E]">
                  入力値に確認が必要な項目があります。資料確認前の条件確定は推奨しません。
                </p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-surface p-3">
                  <p className="text-[10px] text-sub">月平均技術売上</p>
                  <p className="mt-1 text-[14px] font-bold text-ink">
                    {mp.avg_monthly_technical_sales != null
                      ? `${mp.avg_monthly_technical_sales.toLocaleString()}円`
                      : "未入力"}
                  </p>
                </div>
                <div className="rounded-lg bg-surface p-3">
                  <p className="text-[10px] text-sub">月平均客数</p>
                  <p className="mt-1 text-[14px] font-bold text-ink">
                    {mp.avg_monthly_clients != null ? `${mp.avg_monthly_clients}名` : "未入力"}
                  </p>
                </div>
                <div className="rounded-lg bg-surface p-3">
                  <p className="text-[10px] text-sub">指名客数</p>
                  <p className="mt-1 text-[14px] font-bold text-ink">
                    {mp.avg_monthly_named_clients != null ? `${mp.avg_monthly_named_clients}名` : "未入力"}
                  </p>
                </div>
                <div className="rounded-lg bg-surface p-3">
                  <p className="text-[10px] text-sub">持ち込み見込み</p>
                  <p className="mt-1 text-[14px] font-bold text-ink">
                    {mp.expected_transfer_clients != null ? `${mp.expected_transfer_clients}名` : "未入力"}
                  </p>
                </div>
              </div>
            </>
          )}
          {mp.verification_status === "self_reported" && (
            <p className="mt-3 text-[10.5px] text-sub">現在は本人による自己申告です</p>
          )}
        </div>
      )}

      {interest.specialties.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {interest.specialties.map((specialty) => (
            <span
              key={specialty}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-charcoal"
            >
              {specialty}
            </span>
          ))}
        </div>
      )}

      {interest.bio && <p className="mt-3 text-[12.5px] leading-relaxed text-charcoal">{interest.bio}</p>}

      {canOffer ? (
        <SalonOfferForm stylistUserId={interest.stylist_user_id} existingOffer={latestOffer} storeId={storeId} recruitingPaused={recruitingPaused} />
      ) : (
        <p className="mt-3 rounded-lg bg-surface2 px-3 py-2 text-[10.5px] leading-relaxed text-sub">
          給与条件の提示は、実績に基づくオファーを希望し、提出資料の確認が完了した美容師に行えます。
        </p>
      )}
    </article>
  );
}
