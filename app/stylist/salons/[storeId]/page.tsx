import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { calculateStylistStoreMatch } from "@/lib/matching/actions";
import { getPublicSalonStoreDetail } from "@/lib/store-activity/actions";
import { deriveSalonTypes, SALON_TYPE_CONTENT } from "@/lib/salon-culture/salon-culture-types";
import { MATCH_AXIS_LABELS } from "@/lib/matching/types";
import { SALON_VALUE_PRIORITY_OPTIONS } from "@/lib/validation/profile-options";
import { StoreInterestButton } from "@/components/stylist-salons/store-interest-button";

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

  const match = await calculateStylistStoreMatch(store.store_id);

  const culture = store.culture;
  const classification = culture?.culture_axes ? deriveSalonTypes(culture.culture_axes) : null;

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

  const location = [store.prefecture, store.city].filter(Boolean).join(" ");

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

      <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
        <h1 className="font-serif text-2xl font-bold text-ink">{store.store_name}</h1>
        {location && <p className="mt-1 text-[13px] text-sub">{location}</p>}
        {store.street_address && <p className="mt-1 text-[12.5px] text-sub">{store.street_address}</p>}

        {(employeeSizeLabel || store.target_specialties.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {employeeSizeLabel && (
              <span className="rounded-full border border-line bg-surface2 px-2.5 py-1 text-[11px] text-charcoal">
                従業員数: {employeeSizeLabel}
              </span>
            )}
            {store.target_specialties.map((s) => (
              <span key={s} className="rounded-full border border-line bg-surface2 px-2.5 py-1 text-[11px] text-charcoal">
                {s}
              </span>
            ))}
          </div>
        )}

        {store.bio && <p className="mt-4 text-[13.5px] leading-relaxed text-charcoal">{store.bio}</p>}
        {store.culture_description && (
          <p className="mt-4 text-[13.5px] leading-relaxed text-charcoal">{store.culture_description}</p>
        )}
      </section>

      {culture?.comment && (
        <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
          <p className="eyebrow mb-3">店舗からの一言</p>
          <p className="text-[13.5px] leading-relaxed text-charcoal">{culture.comment}</p>
        </section>
      )}

      <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
        <p className="eyebrow mb-3 text-center">あなたらしさ × サロンらしさ</p>

        {match === null && <p className="text-center text-[12.5px] text-sub">相性を確認できませんでした。</p>}

        {match && !match.available && (
          <p className="text-center text-[12.5px] leading-relaxed text-charcoal">
            {match.reason === "stylist_preference_incomplete"
              ? "働きたいサロン環境を回答すると相性が分かります"
              : "相性診断準備中"}
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

      <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
        <p className="eyebrow mb-3">この店舗のタイプ</p>

        {!culture && (
          <p className="text-[12.5px] leading-relaxed text-charcoal">サロンらしさは現在準備中です</p>
        )}

        {culture && classification && (
          <div>
            <div className="text-center">
              <div className="mx-auto h-44 w-full max-w-[220px] overflow-hidden rounded-[28px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={SALON_TYPE_CONTENT[classification.mainType].characterImagePath}
                  alt={SALON_TYPE_CONTENT[classification.mainType].name}
                  className="h-full w-full object-contain"
                />
              </div>
              <p className="mt-2 font-serif text-[20px] font-bold text-ink">
                {SALON_TYPE_CONTENT[classification.mainType].name}
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-charcoal">
                {SALON_TYPE_CONTENT[classification.mainType].description}
              </p>
            </div>

            <div className="mt-5 border-t border-line pt-4 text-center">
              <p className="eyebrow mb-2">サブタイプ</p>
              <p className="text-[14px] font-semibold text-ink">
                <span aria-hidden="true">{SALON_TYPE_CONTENT[classification.subType].icon}</span>{" "}
                {SALON_TYPE_CONTENT[classification.subType].name}
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-sub">
                {SALON_TYPE_CONTENT[classification.subType].description}
              </p>
            </div>
          </div>
        )}
      </section>

      {culture?.value_priorities && culture.value_priorities.length > 0 && (
        <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
          <p className="eyebrow mb-3">今、大切にしている価値観</p>
          <ol className="list-decimal space-y-1 pl-5 text-[13.5px] leading-relaxed text-charcoal">
            {culture.value_priorities.map((code) => {
              const opt = SALON_VALUE_PRIORITY_OPTIONS.find((o) => o.code === code);
              return <li key={code}>{opt?.label ?? code}</li>;
            })}
          </ol>
        </section>
      )}

      {culture?.ai_summary && (
        <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
          <p className="eyebrow mb-3">AIによる店舗紹介</p>
          <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-charcoal">{culture.ai_summary}</p>
        </section>
      )}

      {store.hotpepper_url && (
        <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
          <p className="eyebrow mb-3">この店舗をもっと見る</p>
          <a
            href={store.hotpepper_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center rounded-full border border-line bg-surface2 px-6 py-3.5 text-[13.5px] font-semibold text-ink"
          >
            ホットペッパービューティーを見る
          </a>
        </section>
      )}
    </main>
  );
}
