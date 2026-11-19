import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { calculateStylistStoreMatch, getOwnPreferenceAxes } from "@/lib/matching/actions";
import { classifyMatchUnavailable, MATCH_UNAVAILABLE_MESSAGES, isStylistSideCause } from "@/lib/matching/readiness";
import { getPublicSalonStoreDetail } from "@/lib/store-activity/actions";
import { MATCH_AXIS_LABELS } from "@/lib/matching/types";
import { StoreDetailView } from "@/components/stylist-salons/store-detail-view";
import { StoreInterestButton } from "@/components/stylist-salons/store-interest-button";
import { loadStoreAssets } from "@/lib/store-assets/load";

type Props = {
  params: Promise<{ storeId: string }>;
};

/**
 * 美容師向け店舗詳細（法人・複数店舗対応 Phase 6）。/stylist/salons のカードから遷移する。
 *
 * ★store_idがURLの正。店舗情報はget_public_salon_store_detail(storeId)（0036）、
 * 相性はcalculate_stylist_store_match(storeId)（0031）。旧salon_user_id単位の
 * 取得・相性・Interest（salon_profiles / calculate_stylist_salon_match /
 * set_salon_interest）は使わない。
 *
 * ★公開中でない店舗・存在しない店舗・取得不可は404相当（notFound）。
 *
 * ★culture_axes（12軸の生数値）はこのServer Component内でderiveSalonTypes()に
 * 渡してタイプ名を算出するためだけに使い、JSXには算出済みのタイプ名・説明
 * だけを埋め込む（既存の詳細画面と同じ方針。ブラウザへ12軸は送らない）。
 */
export default async function StylistStoreDetailPage({ params }: Props) {
  const { storeId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/stylist/salons/${storeId}`);
  }

  if (!(await hasCompletedRole(supabase, user.id, "stylist"))) {
    redirect("/onboarding");
  }

  const store = await getPublicSalonStoreDetail(storeId);
  if (!store) {
    notFound();
  }

  let employeeSizeLabel: string | null = null;
  if (store.employee_size_code) {
    const { data: sizeRow } = await supabase
      .from("employee_size_master")
      .select("*")
      .eq("code", store.employee_size_code)
      .maybeSingle();
    employeeSizeLabel = sizeRow?.label ?? null;
  }

  // 店舗別のロゴ・写真・リンク（0081。未適用・取得失敗のときは表示しないだけで、画面は従来どおり）。
  const assetsResult = await loadStoreAssets(supabase, store.store_id, "stylist");
  const match = await calculateStylistStoreMatch(store.store_id);
  // 相性を表示できないときだけ、原因（美容師側／店舗側）の判定に使う。取得失敗は undefined（断定しない）。
  const ownPreference = match && !match.available ? await getOwnPreferenceAxes() : null;
  const matchCause =
    match && !match.available
      ? classifyMatchUnavailable({
          reason: match.reason,
          stylistAxes: ownPreference ? ownPreference.axes : undefined,
          storeAxes: store.culture ? store.culture.culture_axes : undefined,
        })
      : null;

  // 「話を聞いてみたい」の送信済み判定。stylist_salon_interestsには美容師本人の
  // SELECTのみ許可するRLS（stylist_user_id = auth.uid()）が既にあるため、
  // 本人×この店舗の行の有無だけを確認する（新しいDB変更は不要）。
  const { data: interestRow } = await supabase
    .from("stylist_salon_interests")
    .select("id")
    .eq("stylist_user_id", user.id)
    .eq("store_id", store.store_id)
    .maybeSingle();
  const isInterested = !!interestRow;

  return (
    <main className="mx-auto max-w-[640px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <Link href="/stylist/salons" className="text-[13px] font-semibold text-sub underline">
        ← 店舗一覧に戻る
      </Link>

      <StoreInterestButton storeId={store.store_id} isInterested={isInterested} />

      <StoreDetailView
        store={store}
        employeeSizeLabel={employeeSizeLabel}
        assets={assetsResult.status === "ok" ? assetsResult.assets : null}
        matchSection={
        <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
          <p className="eyebrow mb-3 text-center">あなたらしさ × サロンらしさ</p>

          {match === null && <p className="text-center text-[12.5px] text-sub">相性を確認できませんでした。</p>}

          {match && !match.available && matchCause && (
            <p className={`text-center text-[12.5px] leading-relaxed ${isStylistSideCause(matchCause) ? "text-charcoal" : "text-sub"}`}>
              {MATCH_UNAVAILABLE_MESSAGES[matchCause]}
            </p>
          )}

          {match?.available && (
            <>
              <div className="text-center">
                <p className="text-[12px] text-sub">総合マッチ度</p>
                <p className="mt-1 text-[52px] font-bold leading-none" style={{ color: "#2E8B7F" }}>
                  {match.overall_score}
                  <span className="text-[24px] align-top">%</span>
                </p>
              </div>
              <div className="mt-6 space-y-3">
                {(Object.keys(MATCH_AXIS_LABELS) as (keyof typeof MATCH_AXIS_LABELS)[]).map((key) => (
                  <div key={key} className="flex items-center gap-3">
                    <span className="w-[104px] shrink-0 text-[12px] text-sub">{MATCH_AXIS_LABELS[key]}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface2">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${match.axis_scores[key]}%`, background: "#2E8B7F" }}
                      />
                    </div>
                    <span className="w-9 shrink-0 text-right text-[12px] text-sub">{match.axis_scores[key]}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
        }
      />
    </main>
  );
}
