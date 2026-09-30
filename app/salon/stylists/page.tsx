import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { SalonStylistCard } from "@/components/scouts/salon-stylist-card";
import type { PublicStylistForScout } from "@/lib/scouts/types";

/**
 * サロン専用の美容師一覧画面（スカウト機能Ver.1）。
 *
 * ★role guard: /stylist/salons/page.tsxと同じ多重防御パターン
 * （middlewareに加え、このページ自体でもsalon roleの完了を確認する）。
 *
 * ★対象美容師の取得: get_public_stylists_for_scout()（SECURITY DEFINER RPC）
 * が role=stylist・visibility=PUBLIC・scout_enabled の判定と相性計算を
 * すべて行い、相性が高い順に返す。stylist_profilesには本人以外への
 * SELECTポリシーが無いため、このRPC経由の一覧取得が唯一の閲覧経路。
 *
 * ★月間スカウト枠: salon_scout_quotasに行が無いサロンはデフォルト
 * （monthly_free_limit=10, additional_credits=0）として扱う（send_scout
 * RPC側のcoalesceと同じロジックをここでも踏襲）。当月の使用数は
 * scouts.sent_atを直接集計する（専用カウンタ列は持たない）。
 */
export default async function SalonStylistsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/salon/stylists");
  }

  if (!(await hasCompletedRole(supabase, user.id, "salon"))) {
    redirect("/onboarding/salon");
  }

  const { data: quota } = await supabase
    .from("salon_scout_quotas")
    .select("*")
    .eq("salon_user_id", user.id)
    .maybeSingle();
  const monthlyFreeLimit = quota?.monthly_free_limit ?? 10;
  const additionalCredits = quota?.additional_credits ?? 0;

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const { count: usedThisMonth } = await supabase
    .from("scouts")
    .select("id", { count: "exact", head: true })
    .eq("salon_user_id", user.id)
    .gte("sent_at", monthStart.toISOString());

  const remainingQuota = Math.max(0, monthlyFreeLimit + additionalCredits - (usedThisMonth ?? 0));

  const { data: stylistsData, error } = await supabase.rpc("get_public_stylists_for_scout");
  if (error) {
    console.error("[SalonStylistsPage] get_public_stylists_for_scout failed", { message: error.message, code: error.code });
  }
  const stylists: PublicStylistForScout[] = stylistsData ?? [];

  // ★美容師の回答状態(response_status/response_message/responded_at)を
  // サロン側で確認できるようにする対応。scoutsテーブルはRLS
  // （scouts_select_salon: salon_user_id = auth.uid()）で既に自分が送った
  // 分だけSELECTできるため、新しいRPC・migrationを追加せず、既存の権限の
  // まま直接テーブルを取得するだけで実現できる（0025は変更していない）。
  // sent_at → created_at → id の順で決定的にソートし、stylist_user_idごとに
  // 最初に現れる行（＝最新のスカウト）だけを採用する
  // （StylistScoutCard側の最新判定と同じ考え方）。
  const { data: sentScouts } = await supabase
    .from("scouts")
    .select("*")
    .eq("salon_user_id", user.id)
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  const latestScoutByStylist = new Map<string, NonNullable<typeof sentScouts>[number]>();
  for (const s of sentScouts ?? []) {
    if (!latestScoutByStylist.has(s.stylist_user_id)) latestScoutByStylist.set(s.stylist_user_id, s);
  }

  return (
    <main className="mx-auto max-w-[640px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <p className="eyebrow mb-2">美容師を探す</p>
      <h1 className="font-serif text-2xl font-bold text-ink">スカウトする美容師を探す</h1>
      <p className="mt-3 text-[13px] leading-relaxed text-charcoal">
        公開しているプロフィールの中から、相性が高い順に表示しています。
      </p>

      <div className="mt-4 rounded-2xl border border-line bg-surface2 p-4 text-center">
        <p className="text-[11px] text-sub">今月の残りスカウト枠</p>
        <p className="mt-1 text-[20px] font-bold text-ink">{remainingQuota}件</p>
        {remainingQuota <= 0 && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-[#8A2E2E]">
            今月のスカウト枠を使い切りました。追加スカウト購入機能は準備中です。
          </p>
        )}
      </div>

      {stylists.length === 0 ? (
        <p className="mt-8 text-center text-[13px] text-sub">現在、スカウト対象の美容師はいません。</p>
      ) : (
        <div className="mt-8 space-y-4">
          {stylists.map((stylist) => (
            <SalonStylistCard
              key={stylist.stylist_user_id}
              stylist={stylist}
              remainingQuota={remainingQuota}
              latestScout={latestScoutByStylist.get(stylist.stylist_user_id) ?? null}
            />
          ))}
        </div>
      )}

      <Link href="/salon/mypage" className="mt-8 block text-center text-[13px] text-sub underline">
        マイページに戻る
      </Link>
    </main>
  );
}
