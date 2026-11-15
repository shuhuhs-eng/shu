import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { GUEST_NOT_CARRIED_NOTICE_COOKIE } from "@/lib/diagnosis-handoff/constants";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { DiagnosisSummary } from "@/components/mypage/diagnosis-summary";
import { CareerPhaseSummary } from "@/components/student-diagnosis/career-phase-summary";
import { StudentCurrentCard } from "@/components/student-diagnosis/student-current-card";
import { readOwnCareerPhase } from "@/lib/student-diagnosis/career-phase";
import { decideDiagnosisView, mypageSections, readCurrentDiagnosis } from "@/lib/student-diagnosis/current";
import { computeStudentResult } from "@/lib/student-diagnosis/result";
import { STUDENT_DIAGNOSIS_VERSION, isValidStudentAnswers } from "@/lib/student-diagnosis/questions";
import { CoreTypeHeader } from "@/components/mypage/core-type-header";
import { CoreTypeDetails } from "@/components/mypage/core-type-details";
import { MarketValueCard } from "@/components/mypage/market-value-card";
import { AiNarrativeBlocks } from "@/components/mypage/ai-narrative-blocks";
import { TraitRadar } from "@/components/diagnosis/trait-radar";
import { OrderMadeMatchCard } from "@/components/mypage/order-made-match-card";
import { RetakeLink } from "@/components/mypage/retake-link";
import { getStylistRetakeLimit, retakeNotice } from "@/lib/diagnosis-limit/retake-status";
import { buildExperienceProfile } from "@/lib/diagnosis/experience-profile";
import { CORE_TYPE_CONTENT } from "@/lib/diagnosis/core-type-content";
import type { AiOutputType, Database } from "@/types/database";
import type { TraitScores } from "@/lib/diagnosis";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { getNotificationsForBell } from "@/lib/notifications/get-notifications";
import { getMyHiringProcesses } from "@/lib/hiring/actions";
import { isClosedStatus } from "@/lib/hiring/format";
import { nowMs } from "@/lib/perf/timer";
import { readOwnAgeDisplayMode, readOwnBirthDate } from "@/lib/profile/birth-date";
import { calculateCoreType, type CoreTypeCode } from "@/lib/diagnosis/core-types";

type AiOutputRow = Database["public"]["Tables"]["diagnosis_ai_outputs"]["Row"];

/**
 * 美容師専用マイページ（役割別ルーティング分離・複数role対応）。
 *
 * ★複数role対応での変更点: 以前は profile.role === "salon" かどうかだけで
 * サロン側へ弾いていたが、これだと「美容師roleを完了済みだが、legacyの
 * profiles.role が最初に登録したsalonのまま」というユーザーを誤って弾いて
 * しまう。user_roles（そのroleのオンボーディング完了記録）を正として判定する。
 * 美容師roleを完了していないユーザーがアクセスした場合は、サロン側へ
 * 決め打ちで飛ばすのではなく、美容師オンボーディングへ誘導する。
 */
export default async function StylistMyPage() {
  const guestNoticeReason = (await cookies()).get(GUEST_NOT_CARRIED_NOTICE_COOKIE)?.value;
  const guestNotCarried = !!guestNoticeReason;
  const perfStart = nowMs();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const perfAuthDone = nowMs();

  if (!user) {
    redirect("/login?next=/stylist/mypage");
  }

  // 0071の区分（学生・新卒）と「現在の診断」。表・列が無い（0071未適用）ときは従来の表示のまま。
  // 現在の診断が学生・新卒なら、過去の経験者診断（才能グラフ・経験分析・AI解説）を現在の結果として出さない。
  const careerPhase = await readOwnCareerPhase(supabase, user.id);
  const currentRead = careerPhase.status === "ok" ? await readCurrentDiagnosis(supabase, user.id) : ({ status: "unsupported" } as const);
  const diagView = decideDiagnosisView(currentRead);
  const sections = mypageSections(diagView);
  let studentResult: ReturnType<typeof computeStudentResult> | null = null;
  let hasAnyStudentResult = false;
  if (careerPhase.status === "ok") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdb = (supabase as any).from("student_diagnosis_results");
    if (sections.showStudent && currentRead.status === "ok" && currentRead.current) {
      const { data, error } = await sdb.select("answers, version").eq("id", currentRead.current.resultId).eq("user_id", user.id).maybeSingle();
      if (!error && data && isValidStudentAnswers(data.answers)) studentResult = computeStudentResult(data.answers, data.version ?? STUDENT_DIAGNOSIS_VERSION);
      hasAnyStudentResult = true;
    } else {
      const { data, error } = await sdb.select("id").eq("user_id", user.id).limit(1);
      hasAnyStudentResult = !error && (data?.length ?? 0) > 0;
    }
  }
  const studentLink = sections.showStudent ? "current" : hasAnyStudentResult ? "past" : "none";

  // 以下の取得は互いに依存しないため、まとめて並列に実行する（以前は1件ずつ直列で、表示まで10回以上の
  // DB往復を順番に待っていた）。取得する内容・認証/権限確認（getUser・role確認）は変えていない。
  // role未完了の場合はこの直後にredirectするので、並列に取得した結果は使われず破棄される。
  const [
    hasStylistRole,
    birthRead,
    ageModeRead,
    { data: latest },
    { data: preferenceProfile },
    { data: matchProfile, error: matchProfileError },
    retakeLimit,
    scoutTotal,
    scoutUnread,
    offerTotal,
    offerPending,
    hiringProcesses,
    { notifications, unreadCount },
  ] = await Promise.all([
    hasCompletedRole(supabase, user.id, "stylist"),
    readOwnBirthDate(supabase, user.id),
    readOwnAgeDisplayMode(supabase, user.id),
    supabase
      .from("diagnosis_results")
      .select("*")
      .eq("user_id", user.id)
      .eq("mode", "stylist")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // ★「働きたいサロン環境」Preference診断（8問・8軸）。既存の30問診断とは完全に別物
    // （診断ロジック・8タイプ・市場価値・AIには一切影響しない、回答済み状態の確認のみ）。
    supabase.from("stylist_preference_profiles").select("status").eq("stylist_user_id", user.id).maybeSingle(),
    supabase.from("stylist_match_profiles").select("status, primary_goal, secondary_goals, career_stage").eq("stylist_user_id", user.id).maybeSingle(),
    // 回数制限（0058）の状態。関数が無い（未適用）・失敗のときは「制限は有効でない」として扱い、制限の説明を出さない。
    getStylistRetakeLimit(supabase),
    // ★届いたスカウト／オファーは専用画面（/stylist/scouts・/stylist/offers）へ移した。
    // ここでは件数だけを本人宛(stylist_user_id=自分)の既存テーブルから数える。
    supabase.from("scouts").select("id", { count: "exact", head: true }).eq("stylist_user_id", user.id),
    supabase.from("scouts").select("id", { count: "exact", head: true }).eq("stylist_user_id", user.id).eq("read_status", "unread"),
    supabase.from("salary_offers").select("id", { count: "exact", head: true }).eq("stylist_user_id", user.id),
    supabase.from("salary_offers").select("id", { count: "exact", head: true }).eq("stylist_user_id", user.id).eq("status", "pending"),
    // 選考状況（Phase 8）。本人の進捗だけを返す get_my_hiring_processes から件数を数える。
    getMyHiringProcesses(),
    getNotificationsForBell(supabase, user.id),
  ]);

  const perfFetchDone = nowMs();

  if (!hasStylistRole) {
    redirect("/onboarding");
  }

  // 生年月日・表示方法の登録案内。両方読めた（=DB対応）ときだけ判定する。
  const ageRegistration: { needed: boolean; missing: string } =
    birthRead.status === "ok" && ageModeRead.status === "ok" && (birthRead.birthDate == null || ageModeRead.mode == null)
      ? {
          needed: true,
          missing: birthRead.birthDate == null && ageModeRead.mode == null ? "生年月日の登録と年齢の表示方法の選択が必要です" : birthRead.birthDate == null ? "生年月日の登録が必要です" : "年齢の表示方法の選択が必要です",
        }
      : { needed: false, missing: "" };

  // 最新の診断（latest）に紐づくAI解説と8タイプ判定の履歴は、latest.id が決まってから並列に取得する。
  const aiByType: Partial<Record<AiOutputType, unknown>> = {};
  let latestCoreTypeCode: string | null = null;
  if (latest) {
    const [{ data: aiOutputs }, { data: latestCoreHistory }] = await Promise.all([
      supabase
        .from("diagnosis_ai_outputs")
        .select("*")
        .eq("diagnosis_result_id", latest.id)
        .eq("is_current", true),
      // 8タイプは「最新の診断」の判定（履歴は診断のたびに1行追加される現在の傾向）。
      supabase
        .from("stylist_core_type_history")
        .select("top_type_code")
        .eq("diagnosis_result_id", latest.id)
        .maybeSingle(),
    ]);
    for (const row of (aiOutputs ?? []) as AiOutputRow[]) {
      aiByType[row.output_type] = row.response;
    }
    latestCoreTypeCode = latestCoreHistory?.top_type_code ?? null;
  }
  // 処理時間の計測（個人情報・回答内容・トークンは含めない）。Vercel Logsで "[perf] mypage" を検索する。
  console.info("[perf] mypage", {
    authMs: Math.round(perfAuthDone - perfStart),
    parallelFetchMs: Math.round(perfFetchDone - perfAuthDone),
    dependentFetchMs: Math.round(nowMs() - perfFetchDone),
    region: process.env.VERCEL_REGION ?? null,
  });
  // 履歴が無い場合（8タイプ判定の保存に失敗した等）は、最新診断のスコアから同じ判定式（SQLと一致）で求める。
  // 初回確定のassignment（過去の診断由来）は表示に使わない＝古いタイプが現在の結果として出ない。
  const coreTypeCode: CoreTypeCode | null = latest
    ? ((latestCoreTypeCode as CoreTypeCode | null) ??
      calculateCoreType({
        T: latest.craft_score,
        S: latest.sense_score,
        H: latest.hospitality_score,
        B: latest.brand_score,
        A: latest.drive_score,
        M: latest.mentor_score,
      }).topType)
    : null;

  const hasCompletedPreference = preferenceProfile?.status === "completed";
  const hasMatchProfile = matchProfile?.status === "completed";
  const hiringTotalCount = hiringProcesses?.length ?? 0;
  const hiringActiveCount = (hiringProcesses ?? []).filter((p) => !isClosedStatus(p.status)).length;
  const scoutTotalCount = scoutTotal.count ?? 0;
  const scoutUnreadCount = scoutUnread.count ?? 0;
  const offerTotalCount = offerTotal.count ?? 0;
  const offerPendingCount = offerPending.count ?? 0;

  const showNewStylistDesign = !!coreTypeCode && !!latest;
  const hasMatchProfileData = hasMatchProfile && !!matchProfile;

  const traitScores: TraitScores | null = latest
    ? {
        T: latest.craft_score,
        S: latest.sense_score,
        H: latest.hospitality_score,
        B: latest.brand_score,
        A: latest.drive_score,
        M: latest.mentor_score,
      }
    : null;

  // 保存済みの回答と6才能から、経験・実績の特徴と伸ばせる点を読み出す（読めない旧データは出さない）。
  const experienceProfile = latest && traitScores ? buildExperienceProfile(latest.answers, traitScores) : null;

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-2 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
        <NotificationBell notifications={notifications} unreadCount={unreadCount} role="stylist" />
        <Link href="/" className="text-[12px] font-semibold text-sub underline shrink-0">
          ← HOME
        </Link>
      </div>

      {!showNewStylistDesign && <h1 className="mt-5 font-serif text-2xl font-bold text-ink">マイページ</h1>}

      {/* 生年月日の登録と年齢の表示方法の選択が済むまで、サロン向けの一覧には表示されない。ログインや他の機能は妨げず、入力を案内する。
          読み込めない場合（未対応のDB・通信エラー）は案内を出さない（誤って「未登録」と伝えない）。 */}
      {ageRegistration.needed && (
        <p role="status" className="mt-4 rounded-xl border border-[#C98A1B]/40 bg-[#C98A1B]/[0.08] px-4 py-3 text-[13px] leading-relaxed text-[#7A5410]">
          <span className="font-bold">【サロンにはまだ表示されていません】</span>
          {ageRegistration.missing}。
          <Link href="/stylist/profile" className="font-semibold underline">プロフィール</Link>で登録すると、サロン向けの一覧に表示されます。
        </p>
      )}

      {/* 「いまの立場」と学生・新卒診断への導線。経験者向けの診断結果の表示の有無に左右されない位置。 */}
      {careerPhase.status === "ok" && <CareerPhaseSummary value={careerPhase.value} studentLink={studentLink} />}

      {sections.showUnknownNotice && (
        <p role="status" className="mt-6 rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] leading-relaxed text-charcoal">
          現在の診断結果を確認できませんでした。しばらくしてから、もう一度開いてください。
        </p>
      )}

      {sections.showStudent && (
        <div className="mt-6 space-y-4">
          {studentResult ? (
            <StudentCurrentCard result={studentResult} hasPastExperienced={!!latest} />
          ) : (
            <p role="status" className="rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] leading-relaxed text-charcoal">学生・新卒の診断結果を読み込めませんでした。しばらくしてから、もう一度開いてください。</p>
          )}
          {!retakeNotice(retakeLimit).canStart ? (
            <>
              <span aria-disabled="true" className="flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-4 text-[15px] font-semibold text-sub/70">診断を受け直す（いまは変更できません）</span>
              <p className="text-center text-[12.5px] leading-relaxed text-sub">{retakeNotice(retakeLimit).lockedText}</p>
            </>
          ) : (
            <div className="grid gap-3">
              <Link href="/stylist/diagnosis/student" className="flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-4 text-[15px] font-semibold text-ink">学生・新卒の診断を受け直す</Link>
              <Link href="/stylist/diagnosis" className="flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-3.5 text-[14px] font-semibold text-ink">現役の美容師向けの診断を受ける</Link>
            </div>
          )}
        </div>
      )}

      {sections.showExperienced && (showNewStylistDesign && coreTypeCode && traitScores && latest ? (
        <>
          <CoreTypeHeader coreTypeCode={coreTypeCode} />

          <div className="mt-2 space-y-4">
            <section className="rounded-2xl border border-line bg-surface p-6">
              <p className="eyebrow mb-3">6つの才能のバランス</p>
              <TraitRadar scores={traitScores} accent={CORE_TYPE_CONTENT[coreTypeCode].primaryColor} />
            </section>

            {experienceProfile && <MarketValueCard profile={experienceProfile} salaryBand={latest.salary_band} />}

            <AiNarrativeBlocks
              aiByType={aiByType}
              isGenerating={latest.ai_status === "PENDING" || latest.ai_status === "GENERATING"}
            />

            <CoreTypeDetails coreTypeCode={coreTypeCode} />
          </div>

        </>
      ) : (
        <>
          <div className="mt-6">
            <DiagnosisSummary latest={latest} aiByType={aiByType} />
          </div>

          {!latest && guestNotCarried && (
            <p className="mt-6 rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] leading-relaxed text-charcoal">
              {guestNoticeReason === "unverified"
                ? "ログイン前に受けた診断の結果は、登録の状況を確認できなかったため、保存できませんでした。"
                : "ログイン前に受けた診断の結果は、登録の確認までに時間がたったため、保存できませんでした。"}
              お手数ですが、もう一度診断を受けてください。
            </p>
          )}
          {latest && !retakeNotice(retakeLimit).canStart ? (
            <>
              <span aria-disabled="true" className="mt-6 flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-4 text-[15px] font-semibold text-sub/70">
                診断を受け直す（いまは変更できません）
              </span>
              <p className="mt-2 text-center text-[12.5px] leading-relaxed text-sub">{retakeNotice(retakeLimit).lockedText}</p>
            </>
          ) : (
            <Link
              href="/stylist/diagnosis"
              className="mt-6 flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-4 text-[15px] font-semibold text-ink"
            >
              {latest ? "診断を受け直す" : "診断を受ける"}
            </Link>
          )}
        </>
      ))}

      {/* ★「働きたいサロン環境」Preference診断（8軸、既存30問診断とは別物）。
          既存の8タイプ・6才能・市場価値・AI解説ブロックとは視覚的に明確に
          区別する（枠線色・見出しを変え、別セクションであることが一目で
          分かるようにしている）。相性％・マッチング結果は今回表示しない
          （まだ実装していないため）。 */}
      <section className="mt-6 rounded-2xl border border-dashed border-line bg-surface2 p-6">
        <p className="eyebrow mb-2">働きたいサロン環境</p>
        {hasCompletedPreference ? (
          <>
            <p className="text-[13px] text-charcoal">回答済みです。</p>
            <Link
              href="/stylist/preference?edit=1"
              className="mt-4 flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-3.5 text-[14px] font-semibold text-ink"
            >
              希望するサロン環境を見直す
            </Link>
          </>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed text-charcoal">
              あなたが働きやすいと感じるサロンの雰囲気を教えてください。
            </p>
            <Link
              href="/stylist/preference"
              className="mt-4 flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-3.5 text-[14px] font-semibold text-ink"
            >
              希望するサロン環境を入力する
            </Link>
          </>
        )}
      </section>

      <div className="mt-4">
        <OrderMadeMatchCard
          profile={hasMatchProfileData && matchProfile ? { primary_goal: matchProfile.primary_goal, secondary_goals: matchProfile.secondary_goals ?? [], career_stage: matchProfile.career_stage } : null}
          coreTypeName={coreTypeCode ? CORE_TYPE_CONTENT[coreTypeCode].name : null}
          loadFailed={!!matchProfileError}
        />
      </div>

      {/* ★届いたスカウト／オファー。店舗単位の専用画面への導線と件数。 */}
      <Link href="/messages" className="mt-4 flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-3.5 text-[14px] font-semibold text-ink">
        運営からの連絡
      </Link>

      <section className="mt-4 space-y-3">
        <Link
          href="/stylist/scouts"
          className="flex items-center justify-between rounded-2xl border border-line bg-surface p-5"
        >
          <span>
            <span className="eyebrow block">届いたスカウト</span>
            <span className="mt-1 block text-[13px] text-charcoal">
              {scoutTotalCount === 0
                ? "まだ届いていません"
                : scoutUnreadCount > 0
                  ? `新着スカウト ${scoutUnreadCount}件（全${scoutTotalCount}件）`
                  : `全${scoutTotalCount}件`}
            </span>
          </span>
          {scoutUnreadCount > 0 && (
            <span className="rounded-full bg-[#C24545] px-2.5 py-1 text-[10px] font-bold text-white">新着</span>
          )}
        </Link>
        <Link
          href="/stylist/offers"
          className="flex items-center justify-between rounded-2xl border border-line bg-surface p-5"
        >
          <span>
            <span className="eyebrow block">届いたオファー</span>
            <span className="mt-1 block text-[13px] text-charcoal">
              {offerTotalCount === 0
                ? "まだ届いていません"
                : offerPendingCount > 0
                  ? `回答待ちのオファー ${offerPendingCount}件（全${offerTotalCount}件）`
                  : `全${offerTotalCount}件`}
            </span>
          </span>
          {offerPendingCount > 0 && (
            <span className="rounded-full bg-[#C24545] px-2.5 py-1 text-[10px] font-bold text-white">回答待ち</span>
          )}
        </Link>
        <Link
          href="/stylist/age-requests"
          className="flex items-center justify-between rounded-2xl border border-line bg-surface p-5"
        >
          <span>
            <span className="eyebrow block">年齢の開示依頼</span>
            <span className="mt-1 block text-[13px] text-charcoal">サロンからの実年齢の開示依頼を確認して、承認・辞退できます</span>
          </span>
        </Link>
        <Link
          href="/stylist/applications"
          className="flex items-center justify-between rounded-2xl border border-line bg-surface p-5"
        >
          <span>
            <span className="eyebrow block">選考状況</span>
            <span className="mt-1 block text-[13px] text-charcoal">
              {hiringTotalCount === 0
                ? "進行中の選考はありません"
                : hiringActiveCount > 0
                  ? `進行中の選考 ${hiringActiveCount}件（全${hiringTotalCount}件）`
                  : `全${hiringTotalCount}件`}
            </span>
          </span>
          {hiringActiveCount > 0 && (
            <span className="rounded-full bg-[#2E8B7F] px-2.5 py-1 text-[10px] font-bold text-white">進行中</span>
          )}
        </Link>
      </section>

      {/* ★「あなたらしさ×サロンらしさ」MVP。既存の30問診断・8タイプ・
          市場価値・Preference・AI表示ブロックとは独立した導線として追加。 */}
      <Link
        href="/stylist/salons"
        className="mt-4 flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-3.5 text-[14px] font-semibold text-ink"
      >
        公開中の店舗を探す
      </Link>

      <Link href="/stylist/profile" className="mt-4 block text-center text-[13px] text-sub underline">
        プロフィール編集
      </Link>

      {/* 再診断は、働きたいサロン・職場の設定より下、ページ最下部の控えめなリンクにする。 */}
      {showNewStylistDesign && <RetakeLink limit={retakeLimit} />}
    </main>
  );
}
