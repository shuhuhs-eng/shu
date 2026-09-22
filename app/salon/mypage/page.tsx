import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { DiagnosisSummary } from "@/components/mypage/diagnosis-summary";
import { SalonAiNarrative } from "@/components/salon-culture/salon-ai-narrative";
import { deriveSalonTypes, SALON_TYPE_CONTENT } from "@/lib/salon-culture/salon-culture-types";
import type { AiOutputType, Database } from "@/types/database";
import { JOB_CHANGE_INTENT_LABELS } from "@/lib/validation/profile-options";
import { CAREER_GOAL_LABELS, type CareerGoalCode } from "@/lib/match-profile/options";
import { SalonOfferForm } from "@/components/salary-offers/salon-offer-form";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { getNotificationsForBell } from "@/lib/notifications/get-notifications";

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

  const { data: latest } = await supabase
    .from("diagnosis_results")
    .select("*")
    .eq("user_id", user.id)
    .eq("mode", "salon")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // ★サロン専用AI（salon_culture_ai_outputs、0012_salon_culture_ai_outputs.sql）
  // を取得する。diagnosis_ai_outputs（美容師向けAI・旧サロン向け誤生成AI）
  // からは一切探さない。旧14問診断（上記latest）の受診有無には一切
  // 依存しない：salon_culture_profilesが存在しさえすれば取得できる
  // （14問診断が未受診でlatestがnullでも、このブロックは正常に動作する）。
  const { data: cultureProfile } = await supabase
    .from("salon_culture_profiles")
    .select("*")
    .eq("salon_user_id", user.id)
    .maybeSingle();

  const salonAiByType: Partial<Record<AiOutputType, unknown>> = {};
  if (cultureProfile) {
    const { data: salonAiOutputs } = await supabase
      .from("salon_culture_ai_outputs")
      .select("*")
      .eq("salon_culture_profile_id", cultureProfile.id)
      .eq("prompt_version", "salon-culture-v1")
      .eq("is_current", true);

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
    console.error("[SalonMyPage] get_received_salon_interests failed", {
      message: interestsError.message,
      code: interestsError.code,
    });
  }
  const interests: ReceivedInterest[] = receivedInterests ?? [];
  const { data: salaryOffers } = await supabase.from("salary_offers").select("*").eq("salon_user_id", user.id).order("created_at", { ascending: false });
  const latestOfferByStylist = new Map<string, NonNullable<typeof salaryOffers>[number]>();
  for (const offer of salaryOffers ?? []) if (!latestOfferByStylist.has(offer.stylist_user_id)) latestOfferByStylist.set(offer.stylist_user_id, offer);

  const { notifications, unreadCount } = await getNotificationsForBell(supabase, user.id);

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
                    <h3 className="font-serif text-[16px] font-bold text-ink">
                      {interest.public_name ?? "美容師"}
                    </h3>
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
                {interest.match_profile?.wants_performance_offer && interest.match_profile.verification_status === "verified" && (
                  <SalonOfferForm stylistUserId={interest.stylist_user_id} existingOffer={latestOfferByStylist.get(interest.stylist_user_id) ?? null} />
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ★導線混同の修正: 「サロンらしさ」と「14問サロン診断」は別機能
          （サロンらしさ=12軸・/salon/culture、14問診断=6才能軸・
          /diagnosis/salon）。以前は見出しが無く、この2ブロックが視覚的に
          地続きになっていたため、「サロンらしさを見る」の直後にある
          14問診断の「診断を受け直す」ボタンを、サロンらしさの続きだと
          誤認しやすい構造だった。hrefは元々どちらも正しいURLを指しており
          変更していない（誤りはリンク先ではなく見出しの欠如）。明確な
          見出しを追加し、区別できるようにする。 */}
      <p className="eyebrow mb-2 mt-6">サロンらしさ</p>
      {salonTypeClassification ? (
        <section className="rounded-2xl border border-line bg-surface p-6 text-center">
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
      ) : (
        <Link
          href="/salon/culture"
          className="flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-4 text-[15px] font-semibold text-ink"
        >
          {!cultureProfile
            ? "サロンらしさ診断を受ける"
            : cultureProfile.status === "draft"
              ? "回答を続ける"
              : "サロンらしさを更新する"}
        </Link>
      )}

      {/* ★サロン専用AI解説。旧14問診断（DiagnosisSummary、下記）とは別の
          場所に配置し、「サロンらしさ」セクションの一部であることを
          視覚的に明確にする。latestが無い（旧14問診断を一度も受けて
          いない）場合、diagnosis_ai_outputsへの紐付け先が無いため
          サロン専用AIは生成されない（lib/salon-culture/actions.ts参照）。
          この場合は latest?.ai_status が無くnullになり、
          SalonAiNarrative側で「サロンらしさを回答すると...」という
          案内が表示される。 */}
      <div className="mt-4">
        <SalonAiNarrative aiByType={salonAiByType} />
      </div>

      <p className="eyebrow mb-2 mt-8">サロン診断（6つの才能軸）</p>
      <div>
        {/* ★「1 auth user = 1 role」方針・サロン側から美容師向け表示を排除する
            対応: showTypeHeader={false} により、美容師個人向け12タイプ名
            （type_name）・その説明文を非表示にする（DiagnosisSummary自体は
            変更していない。既存のshowTypeHeader propを呼び出し側から指定
            するだけ）。
            美容師の市場価値・想定年収（market_value_score/salary_band）は、
            computeDiagnosis()がmode==="salon"の場合に元々null を返す設計
            （lib/diagnosis/index.ts、変更していない）のため、サロン診断結果
            では自然に非表示になる。美容師キャラクター表示（CoreTypeHeader）
            はこのページに元々importされていない。
            調査の結果、サロン診断（14問）が測定する6軸トレイトと、既存の
            「サロンらしさ」（教育支援・挑戦開放性・個人ブランド支援・
            親密重視/距離感重視・経営スタイル）は役割が重複していると判断
            したため、新しいサロン専用12タイプは作らず、この最小修正
            （12タイプ名を隠すだけ）にとどめている。
            ★今回の変更: showAiSection={false} を追加し、美容師本人向け
            プロンプトで誤生成されていたAI解説（prompt_version="1.0.0"）を
            このブロックから非表示にした（DiagnosisSummary自体・その
            AI解説ロジックは変更していない。表示のON/OFFを切り替える
            propを追加しただけで、美容師マイページ側はこのpropを指定
            していないため一切影響を受けない）。サロン専用のAI解説は
            上記のSalonAiNarrativeで別途表示する。 */}
        <DiagnosisSummary latest={latest} aiByType={{}} showTypeHeader={false} showAiSection={false} />
      </div>

      <Link
        href="/salon/culture?edit=1"
        className="mt-4 flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-4 text-[15px] font-semibold text-ink"
      >
        {latest ? "診断を受け直す" : "診断を受ける"}
      </Link>
    </main>
  );
}
