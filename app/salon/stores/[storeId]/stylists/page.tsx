import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { calculateStoreStylistMatch } from "@/lib/matching/actions";
import { StoreStylistCard } from "@/components/scouts/store-stylist-card";
import type { PublicStylistForScout } from "@/lib/scouts/types";

type Props = {
  params: Promise<{ storeId: string }>;
};

/**
 * 店舗単位「美容師を探す」画面（/salon/stores/[storeId]/stylists、
 * 法人・複数店舗対応 Phase 5）。
 *
 * ★アクセス権: layout.tsxと同じく、salon_storesへの直接SELECT
 * （RLS salon_stores_select_accessible = is_store_accessible(id)）の
 * 結果だけで判定する。独自の権限ロジックは実装しない。
 *
 * ★候補美容師データ: get_public_stylists_for_scout()（0025、単純なSELECT
 * RPC・副作用なし）を再利用する。ただしこのRPCが返すmatch（旧salon_user_id
 * 基準の相性）は破棄し、代わりにcalculate_store_stylist_match(storeId,
 * stylistUserId)で店舗単位の相性を1候補ごとに計算し直す。
 *
 * ★direct scoutsテーブル参照（直近の回答状況表示用）はstore_idで絞り込むが、
 * 既存RLS scouts_select_salon（salon_user_id = auth.uid()）がその上に
 * 必ず適用されるため、「このページを開いた担当者自身が送った、この店舗の
 * Scout」しか見えない（他の担当者が送った分は見えない）。これは既存RLSの
 * 構造的な制約であり、このページ側で回避・推測による穴埋めは行わない
 * （次phaseでのRLS/RPC追加が必要な既知のギャップ）。
 *
 * ★送信はsendStoreScout（send_scout_v2）のみ。storeIdは常にURL
 * params.storeIdを使い、salon_user_id・salon_onboarding_assignmentsから
 * 推測しない（2店舗目でも同じ仕組みで成立する）。
 */
export default async function StoreStylistsPage({ params }: Props) {
  const { storeId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/salon/stores/${storeId}/stylists`);
  }

  if (!(await hasCompletedRole(supabase, user.id, "salon"))) {
    redirect("/onboarding/salon");
  }

  const { data: store, error: storeError } = await supabase
    .from("salon_stores")
    .select("*")
    .eq("id", storeId)
    .maybeSingle();

  if (storeError || !store) {
    redirect("/salon/company");
  }

  const { data: stylistsData, error } = await supabase.rpc("get_public_stylists_for_scout");
  if (error) {
    console.error("[StoreStylistsPage] get_public_stylists_for_scout failed", { message: error.message, code: error.code });
  }
  const stylists: PublicStylistForScout[] = stylistsData ?? [];

  // ★直近の回答状況表示用。store_idで絞り込むが、既存RLSによりこの担当者
  // (auth.uid())が自分で送った分だけが返る（ファイル先頭のコメント参照）。
  const { data: sentScouts } = await supabase
    .from("scouts")
    .select("*")
    .eq("store_id", storeId)
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  const latestScoutByStylist = new Map<string, NonNullable<typeof sentScouts>[number]>();
  for (const s of sentScouts ?? []) {
    if (!latestScoutByStylist.has(s.stylist_user_id)) latestScoutByStylist.set(s.stylist_user_id, s);
  }

  // 店舗単位の相性を候補ごとに計算する（既存/stylist/salons・/salon/stylists
  // と同じ、Promise.allによる並列RPC呼び出しパターン）。
  const matches = await Promise.all(
    stylists.map((s) => calculateStoreStylistMatch(storeId, s.stylist_user_id)),
  );

  const rankedStylists = stylists
    .map((stylist, index) => ({ stylist, match: matches[index], originalIndex: index }))
    .sort((a, b) => {
      const aScore = a.match?.available ? a.match.overall_score : -1;
      const bScore = b.match?.available ? b.match.overall_score : -1;
      return bScore - aScore || a.originalIndex - b.originalIndex;
    });

  return (
    <main className="mx-auto max-w-[640px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <Link href={`/salon/stores/${storeId}`} className="text-[13px] font-semibold text-sub underline">
        ← {store.store_name} に戻る
      </Link>

      <p className="eyebrow mb-2 mt-5">美容師を探す</p>
      <h1 className="font-serif text-2xl font-bold text-ink">{store.store_name}</h1>
      <p className="mt-3 text-[13px] leading-relaxed text-charcoal">
        公開している美容師の中から、この店舗との相性を確認してスカウトを送れます。
      </p>

      {rankedStylists.length === 0 ? (
        <p className="mt-8 text-center text-[13px] text-sub">現在、公開している美容師はいません。</p>
      ) : (
        <div className="mt-8 space-y-4">
          {rankedStylists.map(({ stylist, match }) => (
            <StoreStylistCard
              key={stylist.stylist_user_id}
              storeId={storeId}
              stylist={stylist}
              match={match}
              latestScout={latestScoutByStylist.get(stylist.stylist_user_id) ?? null}
            />
          ))}
        </div>
      )}
    </main>
  );
}
