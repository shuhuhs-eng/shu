import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { DiagnosisSummary } from "@/components/mypage/diagnosis-summary";
import { CoreTypeHeader } from "@/components/mypage/core-type-header";
import { CoreTypeDetails } from "@/components/mypage/core-type-details";
import { MarketValueCard } from "@/components/mypage/market-value-card";
import { AiNarrativeBlocks } from "@/components/mypage/ai-narrative-blocks";
import { TraitScoreBars } from "@/components/diagnosis/trait-score-bars";
import type { AiOutputType, Database } from "@/types/database";
import type { TraitScores } from "@/lib/diagnosis";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { getNotificationsForBell } from "@/lib/notifications/get-notifications";
import { getMyHiringProcesses } from "@/lib/hiring/actions";
import { isClosedStatus } from "@/lib/hiring/format";

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/stylist/mypage");
  }

  if (!(await hasCompletedRole(supabase, user.id, "stylist"))) {
    redirect("/onboarding");
  }

  const { data: latest } = await supabase
    .from("diagnosis_results")
    .select("*")
    .eq("user_id", user.id)
    .eq("mode", "stylist")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const aiByType: Partial<Record<AiOutputType, unknown>> = {};
  if (latest) {
    const { data: aiOutputs } = await supabase
      .from("diagnosis_ai_outputs")
      .select("*")
      .eq("diagnosis_result_id", latest.id)
      .eq("is_current", true);

    for (const row of (aiOutputs ?? []) as AiOutputRow[]) {
      aiByType[row.output_type] = row.response;
    }
  }

  // 8タイプ（front-facing称号）。取得できない場合（8タイプ導入前に診断した
  // 既存ユーザー等）は従来のDiagnosisSummaryにフォールバックする。
  const { data: coreType } = await supabase
    .from("stylist_core_type_assignments")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  const coreTypeCode = coreType?.core_type_code ?? null;

  // ★「働きたいサロン環境」Preference診断（8問・8軸）。既存の30問診断とは
  // 完全に別物（診断ロジック・8タイプ・市場価値・AIには一切影響しない、
  // 単なる回答済み状態の確認のための新規クエリ）。
  const { data: preferenceProfile } = await supabase
    .from("stylist_preference_profiles")
    .select("status")
    .eq("stylist_user_id", user.id)
    .maybeSingle();
  const hasCompletedPreference = preferenceProfile?.status === "completed";

  const { data: matchProfile } = await supabase
    .from("stylist_match_profiles")
    .select("status")
    .eq("stylist_user_id", user.id)
    .maybeSingle();
  const hasMatchProfile = matchProfile?.status === "completed";

  // ★届いたスカウト／オファーは専用画面（/stylist/scouts・/stylist/offers）へ
  // 移した（店舗単位で表示）。ここでは件数だけを本人宛(stylist_user_id=自分)の
  // 既存テーブルから数える（新しいRPCは使わない）。
  const [scoutTotal, scoutUnread, offerTotal, offerPending] = await Promise.all([
    supabase.from("scouts").select("id", { count: "exact", head: true }).eq("stylist_user_id", user.id),
    supabase.from("scouts").select("id", { count: "exact", head: true }).eq("stylist_user_id", user.id).eq("read_status", "unread"),
    supabase.from("salary_offers").select("id", { count: "exact", head: true }).eq("stylist_user_id", user.id),
    supabase.from("salary_offers").select("id", { count: "exact", head: true }).eq("stylist_user_id", user.id).eq("status", "pending"),
  ]);
  // 選考状況（Phase 8）。本人の進捗だけを返す get_my_hiring_processes から件数を数える。
  const hiringProcesses = await getMyHiringProcesses();
  const hiringTotalCount = hiringProcesses?.length ?? 0;
  const hiringActiveCount = (hiringProcesses ?? []).filter((p) => !isClosedStatus(p.status)).length;
  const scoutTotalCount = scoutTotal.count ?? 0;
  const scoutUnreadCount = scoutUnread.count ?? 0;
  const offerTotalCount = offerTotal.count ?? 0;
  const offerPendingCount = offerPending.count ?? 0;

  const { notifications, unreadCount } = await getNotificationsForBell(supabase, user.id);

  const showNewStylistDesign = !!coreTypeCode && !!latest;

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

      {showNewStylistDesign && coreTypeCode && traitScores && latest ? (
        <>
          <CoreTypeHeader coreTypeCode={coreTypeCode} />

          <div className="mt-2 space-y-4">
            <section className="rounded-2xl border border-line bg-surface p-6">
              <p className="eyebrow mb-3">6才能スコア</p>
              <TraitScoreBars scores={traitScores} />
            </section>

            {latest.market_value_score != null && (
              <MarketValueCard score={latest.market_value_score} salaryBand={latest.salary_band} />
            )}

            <AiNarrativeBlocks
              aiByType={aiByType}
              isGenerating={latest.ai_status === "PENDING" || latest.ai_status === "GENERATING"}
            />

            <CoreTypeDetails coreTypeCode={coreTypeCode} />
          </div>

          <section className="mt-8 rounded-2xl border border-line bg-surface2 p-6 text-center">
            <p className="text-[13.5px] leading-relaxed text-charcoal">
              あなたの才能は
              <br />
              経験とともに成長します。
              <br />
              半年後にもう一度診断すると、
              <br />
              新しい強みに出会えるかもしれません。
            </p>
            <Link
              href="/stylist/diagnosis"
              className="mt-5 flex w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface"
            >
              もう一度診断する
            </Link>
          </section>
        </>
      ) : (
        <>
          <div className="mt-6">
            <DiagnosisSummary latest={latest} aiByType={aiByType} />
          </div>

          <Link
            href="/stylist/diagnosis"
            className="mt-6 flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-4 text-[15px] font-semibold text-ink"
          >
            {latest ? "診断を受け直す" : "診断を受ける"}
          </Link>
        </>
      )}

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

      <section className="mt-4 rounded-2xl border border-line bg-surface p-6">
        <p className="eyebrow mb-2">オーダーメイドマッチ</p>
        <p className="text-[13px] leading-relaxed text-charcoal">
          {hasMatchProfile
            ? "転職で変えたいことと実績を登録済みです。"
            : "転職で一番変えたいことと、サロンへ提供できる価値を登録します。"}
        </p>
        <Link
          href="/stylist/match-profile"
          className="mt-4 flex w-full items-center justify-center rounded-full border border-line bg-surface2 px-6 py-3.5 text-[14px] font-semibold text-ink"
        >
          {hasMatchProfile ? "登録内容を見直す" : "希望条件を登録する"}
        </Link>
      </section>

      {/* ★届いたスカウト／オファー。店舗単位の専用画面への導線と件数。 */}
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
    </main>
  );
}
