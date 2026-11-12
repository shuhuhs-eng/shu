import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { CultureRadarSection } from "@/components/salon-culture/culture-radar";
import { SalonAiNarrative } from "@/components/salon-culture/salon-ai-narrative";
import { deriveSalonTypes, SALON_TYPE_CONTENT } from "@/lib/salon-culture/salon-culture-types";
import type { AiOutputType, Database } from "@/types/database";
import { JOB_CHANGE_INTENT_LABELS } from "@/lib/validation/profile-options";
import { CAREER_GOAL_LABELS, type CareerGoalCode } from "@/lib/match-profile/options";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { getNotificationsForBell, getUnreadNotificationRefs } from "@/lib/notifications/get-notifications";
import { CardNotificationBadge } from "@/components/notifications/card-notification-badge";
import { logError } from "@/lib/security/log";

type SalonCultureAiOutputRow = Database["public"]["Tables"]["salon_culture_ai_outputs"]["Row"];
type ReceivedInterest = Database["public"]["Functions"]["get_received_salon_interests"]["Returns"][number];

/**
 * サロン専用マイページ（役割別ルーティング分離・複数role対応）。
 *
 * ★複数role対応での変更点: profile.role ではなく user_roles（そのroleの
 * オンボーディング完了記録）で判定する。サロンroleを完了していない
 * ユーザーがアクセスした場合は、美容師側へ決め打ちで飛ばすのではなく、
 * サロンオンボーディングへ誘導する。
 */
export default async function SalonMyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/salon/mypage");
  }

  if (!(await hasCompletedRole(supabase, user.id, "salon"))) {
    redirect("/onboarding/salon");
  }

  // ★サロン専用AI（salon_culture_ai_outputs、0012_salon_culture_ai_outputs.sql）
  // を取得する。diagnosis_ai_outputs（美容師向けAI・旧サロン向け誤生成AI）
  // からは一切探さない。このページは14問診断（diagnosis_results）を読まない
  // （サロンらしさ salon_culture_profiles だけに依存する）。
  const { data: cultureProfile, error: cultureError } = await supabase
    .from("salon_culture_profiles")
    .select("*")
    .eq("salon_user_id", user.id)
    .maybeSingle();
  // 取得エラーを「未回答」と表示しない（読み込み失敗として別に表示する）。
  if (cultureError) logError("salonMypage.cultureProfile", cultureError);

  const salonAiByType: Partial<Record<AiOutputType, unknown>> = {};
  let salonAiLoadFailed = false;
  if (cultureProfile) {
    const { data: salonAiOutputs, error: salonAiError } = await supabase
      .from("salon_culture_ai_outputs")
      .select("*")
      .eq("salon_culture_profile_id", cultureProfile.id)
      .eq("prompt_version", "salon-culture-v1")
      .eq("is_current", true);

    if (salonAiError) {
      logError("salonMypage.aiOutputs", salonAiError);
      salonAiLoadFailed = true;
    }
    for (const row of (salonAiOutputs ?? []) as SalonCultureAiOutputRow[]) {
      salonAiByType[row.output_type] = row.response;
    }
  }

  // サロン8タイプはDBへ追加保存せず、保存済みの12軸から表示時にだけ算出する。
  // 既存の判定ロジック・マッチング・RPCには影響を与えない。
  const salonTypeClassification =
    cultureProfile?.status === "completed" ? deriveSalonTypes(cultureProfile.culture_axes ?? {}) : null;

  const { data: salon } = await supabase
    .from("salon_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  let employeeSizeLabel: string | null = null;
  if (salon?.employee_size_code) {
    const { data: sizeRow } = await supabase
      .from("employee_size_master")
      .select("*")
      .eq("code", salon.employee_size_code)
      .maybeSingle();
    employeeSizeLabel = sizeRow?.label ?? null;
  }

  const { data: receivedInterests, error: interestsError } = await supabase.rpc(
    "get_received_salon_interests",
  );
  if (interestsError) {
    logError("SalonMyPage", interestsError);
  }
  const interests: ReceivedInterest[] = receivedInterests ?? [];
  const { data: salaryOffers } = await supabase.from("salary_offers").select("*").eq("salon_user_id", user.id).order("created_at", { ascending: false });

  const { notifications, unreadCount } = await getNotificationsForBell(supabase, user.id);
  const unreadRefs = await getUnreadNotificationRefs(supabase, user.id);

  // ★カード単位バッジ(美容師ごと): その美容師のsalary_offers id群
  // (related_entity_type='salary_offer')と、意思表示そのもの
  // (related_entity_type='stylist_interest', related_entity_id=stylist_user_id)
  // の両方を突き合わせる。DBスキーマ変更なしで集計できる。
  function unreadEntitiesForStylist(stylistUserId: string) {
    const offerIds = (salaryOffers ?? [])
      .filter((o) => o.stylist_user_id === stylistUserId)
      .map((o) => o.id);
    const entities = [
      ...offerIds.map((id) => ({ type: "salary_offer", id })),
      { type: "stylist_interest", id: stylistUserId },
    ];
    const offerIdSet = new Set(offerIds);
    const count = unreadRefs.filter(
      (r) =>
        (r.related_entity_type === "salary_offer" && r.related_entity_id && offerIdSet.has(r.related_entity_id)) ||
        (r.related_entity_type === "stylist_interest" && r.related_entity_id === stylistUserId),
    ).length;
    return { count, entities };
  }

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-2 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
        <NotificationBell notifications={notifications} unreadCount={unreadCount} role="salon" />
        <Link href="/" className="text-[12px] font-semibold text-sub underline shrink-0">
          ← HOME
        </Link>
      </div>

      <h1 className="mt-5 font-serif text-2xl font-bold text-ink">マイページ</h1>

      <section className="mt-6 rounded-2xl border border-line bg-surface p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow mb-1">サロン概要</p>
            <h2 className="font-serif text-xl font-bold text-ink">{salon?.salon_name ?? "（サロン名未設定）"}</h2>
            <p className="mt-1 text-[13px] text-sub">
              {[salon?.prefecture, salon?.city].filter(Boolean).join(" ") || "所在地未設定"}
            </p>
            {employeeSizeLabel && <p className="mt-1 text-[13px] text-sub">従業員数: {employeeSizeLabel}</p>}
          </div>
          <Link href="/salon/profile" className="text-[13px] font-semibold underline shrink-0">
            サロンプロフィールを編集
          </Link>
        </div>
      </section>

      {/* ★スカウト機能Ver.1への導線。/stylist/salonsの「サロンを探す」導線に
          対称する形で追加。既存セクション（サロン概要・興味を送ってくれた
          美容師）の間には一切変更を加えていない。 */}
      <Link
        href="/salon/stylists"
        className="mt-4 flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-3.5 text-[14px] font-semibold text-ink"
      >
        美容師を探す
      </Link>

      {/* ★法人・複数店舗対応Phase 1への導線を1個追加するだけ。既存の
          コンテンツ・DB取得・表示は一切移動・削除していない。 */}
      <Link
        href="/salon/company"
        className="mt-3 flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-3.5 text-[14px] font-semibold text-ink"
      >
        会社・店舗管理
      </Link>

      <section id="interests" className="mt-6 rounded-2xl border border-line bg-surface p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow mb-1">話を聞いてみたい</p>
            <h2 className="font-serif text-lg font-bold text-ink">興味を送ってくれた美容師</h2>
          </div>
          <span className="rounded-full bg-surface2 px-3 py-1.5 text-[13px] font-bold text-ink">
            {interests.length}名
          </span>
        </div>

        {interests.length === 0 ? (
          <p className="mt-4 text-[13px] leading-relaxed text-sub">
            現在、届いている意思表示はありません。
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {interests.map((interest) => (
              <article
                key={interest.stylist_user_id}
                className="rounded-xl border border-line bg-surface2 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-serif text-[16px] font-bold text-ink">
                        {interest.public_name ?? "美容師"}
                      </h3>
                      {(() => {
                        const { count, entities } = unreadEntitiesForStylist(interest.stylist_user_id);
                        return <CardNotificationBadge count={count} entities={entities} />;
                      })()}
                    </div>
                    <p className="mt-1 text-[12px] text-sub">
                      {[interest.prefecture, interest.current_position].filter(Boolean).join(" / ") ||
                        "プロフィール情報未設定"}
                    </p>
                  </div>
                  {interest.experience_years != null && (
                    <span className="shrink-0 text-[12px] text-sub">
                      経験{interest.experience_years}年
                    </span>
                  )}
                </div>

                {interest.desired_work_location && (
                  <p className="mt-3 text-[12.5px] text-charcoal">
                    希望勤務地: {interest.desired_work_location}
                  </p>
                )}
                <p className="mt-1 text-[12.5px] text-charcoal">
                  {JOB_CHANGE_INTENT_LABELS[interest.job_change_intent]}
                </p>

                {interest.match_profile && (
                  <div className="mt-4 rounded-xl border border-line bg-surface p-4">
                    <p className="eyebrow mb-1">一番変えたいこと</p>
                    <p className="text-[13px] font-bold text-ink">
                      {CAREER_GOAL_LABELS[interest.match_profile.primary_goal as CareerGoalCode] ??
                        interest.match_profile.primary_goal}
                    </p>
                    {interest.match_profile.secondary_goals.length > 0 && (
                      <p className="mt-2 text-[11.5px] leading-relaxed text-sub">
                        ほかに重視: {interest.match_profile.secondary_goals.map((goal) =>
                          CAREER_GOAL_LABELS[goal as CareerGoalCode] ?? goal
                        ).join(" / ")}
                      </p>
                    )}

                    {interest.match_profile.wants_performance_offer && (
                      <>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${
                          interest.match_profile.verification_status === "verified"
                            ? "bg-[#37755B]/15 text-[#285B45]"
                            : interest.match_profile.verification_status === "needs_review" || interest.match_profile.verification_status === "rejected" || interest.match_profile.verification_status === "reverification_needed"
                              ? "bg-[#C24545]/10 text-[#8A2E2E]"
                              : "bg-surface2 text-sub"
                        }`}>
                          {{
                            self_reported: "自己申告",
                            submitted: "資料提出済み・確認中",
                            needs_review: "数字の確認が必要",
                            verified: "提出資料確認済み",
                            reverification_needed: "実績変更のため再確認が必要",
                            rejected: "資料再提出が必要",
                          }[interest.match_profile.verification_status] ?? "自己申告"}
                        </span>
                        {interest.match_profile.evidence_document_count > 0 && <span className="text-[10.5px] text-sub">証明資料 {interest.match_profile.evidence_document_count}件</span>}
                      </div>
                      {interest.match_profile.consistency_issues.length > 0 && <p className="mt-2 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[10.5px] leading-relaxed text-[#8A2E2E]">
                        入力値に確認が必要な項目があります。資料確認前の条件確定は推奨しません。
                      </p>}
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-surface2 p-3">
                          <p className="text-[10px] text-sub">月平均技術売上</p>
                          <p className="mt-1 text-[14px] font-bold text-ink">
                            {interest.match_profile.avg_monthly_technical_sales != null
                              ? `${interest.match_profile.avg_monthly_technical_sales.toLocaleString()}円`
                              : "未入力"}
                          </p>
                        </div>
                        <div className="rounded-lg bg-surface2 p-3">
                          <p className="text-[10px] text-sub">月平均客数</p>
                          <p className="mt-1 text-[14px] font-bold text-ink">
                            {interest.match_profile.avg_monthly_clients != null
                              ? `${interest.match_profile.avg_monthly_clients}名`
                              : "未入力"}
                          </p>
                        </div>
                        <div className="rounded-lg bg-surface2 p-3">
                          <p className="text-[10px] text-sub">指名客数</p>
                          <p className="mt-1 text-[14px] font-bold text-ink">
                            {interest.match_profile.avg_monthly_named_clients != null
                              ? `${interest.match_profile.avg_monthly_named_clients}名`
                              : "未入力"}
                          </p>
                        </div>
                        <div className="rounded-lg bg-surface2 p-3">
                          <p className="text-[10px] text-sub">持ち込み見込み</p>
                          <p className="mt-1 text-[14px] font-bold text-ink">
                            {interest.match_profile.expected_transfer_clients != null
                              ? `${interest.match_profile.expected_transfer_clients}名`
                              : "未入力"}
                          </p>
                        </div>
                      </div>
                      </>
                    )}
                    {interest.match_profile.verification_status === "self_reported" && <p className="mt-3 text-[10.5px] text-sub">現在は本人による自己申告です</p>}
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

                {interest.bio && (
                  <p className="mt-3 text-[12.5px] leading-relaxed text-charcoal">{interest.bio}</p>
                )}
                {/* ★0053: 旧・サロン単位の給与オファー提示（create_salary_offer）は停止した。
                    給与条件の提示は、店舗単位の画面（create_salary_offer_v2）から行う。 */}
                {interest.match_profile?.wants_performance_offer && interest.match_profile.verification_status === "verified" && (
                  <Link
                    href="/salon/company"
                    className="mt-3 flex w-full items-center justify-center rounded-full border border-line bg-surface px-4 py-3 text-[12px] font-bold text-ink"
                  >
                    店舗の画面で給与条件を提示する
                  </Link>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 「サロンらしさ」ブロック（1つに整理）。
          ・見出し「サロンらしさ」＋5軸レーダー＋回答/更新ボタン（CultureRadarSection）
          ・サロンタイプ（既存の12軸から表示時に算出。タイプが出せる場合のみ）
          ・AI紹介文（SalonAiNarrative）
          旧「サロン診断（6つの才能軸）」（14問診断・/diagnosis/salon）の表示と受診ボタンは、
          数値が能力の点数に見えるため外した（14問の保存データ・計算・DBは残している）。
          回答・更新ボタンは、表示している対象と同じ「サロンらしさ」（/salon/culture）へつなぐ。
          表示は salon_culture_profiles（本人の行）だけに依存し、店舗単位の結果とは混ぜない。 */}
      <div className="mt-6">
        <CultureRadarSection
          status={cultureProfile?.status ?? null}
          axes={cultureProfile?.culture_axes}
          loadFailed={!!cultureError}
          answerPath="/salon/culture"
        />
      </div>

      {salonTypeClassification && (
        <section className="mt-4 rounded-2xl border border-line bg-surface p-6 text-center">
          <p className="eyebrow mb-2">あなたのサロンタイプ</p>
          <div className="mx-auto h-48 w-full max-w-[240px] overflow-hidden rounded-[30px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={SALON_TYPE_CONTENT[salonTypeClassification.mainType].characterImagePath}
              alt={SALON_TYPE_CONTENT[salonTypeClassification.mainType].name}
              className="h-full w-full object-contain"
            />
          </div>
          <h2 className="mt-3 font-serif text-xl font-bold text-ink">
            {SALON_TYPE_CONTENT[salonTypeClassification.mainType].name}
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-charcoal">
            {SALON_TYPE_CONTENT[salonTypeClassification.mainType].description}
          </p>

          <div className="mt-5 border-t border-line pt-4">
            <p className="eyebrow mb-2">サブタイプ</p>
            <p className="text-[14px] font-semibold text-ink">
              <span aria-hidden="true">{SALON_TYPE_CONTENT[salonTypeClassification.subType].icon}</span>{" "}
              {SALON_TYPE_CONTENT[salonTypeClassification.subType].name}
            </p>
          </div>

          <Link
            href="/salon/culture/result"
            className="mt-5 flex w-full items-center justify-center rounded-full bg-ink px-6 py-3 text-[14px] font-semibold text-surface"
          >
            詳しい結果を見る
          </Link>
        </section>
      )}

      {/* サロン専用AI解説。表示は salon_culture_profiles（回答状態）と
          salon_culture_ai_outputs（AI紹介文）だけに依存する（0012）。
          未回答・回答済みで未作成・取得失敗を SalonAiNarrative が区別して表示する。 */}
      <div className="mt-4">
        <SalonAiNarrative
          aiByType={salonAiByType}
          cultureStatus={cultureProfile?.status ?? null}
          loadFailed={salonAiLoadFailed}
        />
      </div>
    </main>
  );
}
