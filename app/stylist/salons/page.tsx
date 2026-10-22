import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { calculateStylistStoreMatch } from "@/lib/matching/actions";
import { getPublicSalonStores } from "@/lib/store-activity/actions";
import { StoreCard } from "@/components/stylist-salons/store-card";

/**
 * 美容師専用の「公開中の店舗」一覧（法人・複数店舗対応 Phase 6）。
 *
 * ★店舗単位: 一覧はget_public_salon_stores()（0036）、相性は店舗ごとに
 * calculate_stylist_store_match(store_id)（0031）で取得する。旧salon_user_id
 * 単位の一覧・相性（salon_profiles / calculate_stylist_salon_match）は使わない。
 *
 * ★role guard: middlewareに加えて、このページ自体でもstylist roleの完了を
 * 確認する多重防御（既存パターン）。
 */
export default async function StylistSalonsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/stylist/salons");
  }

  if (!(await hasCompletedRole(supabase, user.id, "stylist"))) {
    redirect("/onboarding");
  }

  const stores = await getPublicSalonStores();

  // employee_size_masterのラベル解決（既存の一覧と同じパターン）。
  const sizeLabelByCode = new Map<string, string>();
  const storeList = stores ?? [];
  const sizeCodes = Array.from(
    new Set(storeList.map((s) => s.employee_size_code).filter((c): c is string => !!c)),
  );
  if (sizeCodes.length > 0) {
    const { data: sizeRows } = await supabase.from("employee_size_master").select("*").in("code", sizeCodes);
    for (const row of sizeRows ?? []) {
      sizeLabelByCode.set(row.code, row.label);
    }
  }

  // 各店舗との相性を並列取得する。
  const matches = await Promise.all(storeList.map((s) => calculateStylistStoreMatch(s.store_id)));

  // 相性を計算できる店舗はスコアの高い順。計算できない店舗はその後ろ（同点は取得順）。
  const rankedStores = storeList
    .map((store, index) => ({ store, match: matches[index], originalIndex: index }))
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

      <p className="eyebrow mb-2">店舗を探す</p>
      <h1 className="font-serif text-2xl font-bold text-ink">あなたらしさ × サロンらしさ</h1>
      <p className="mt-3 text-[13px] leading-relaxed text-charcoal">
        公開中の店舗の中から、あなたの「働きたいサロン環境」との相性を確認できます。
      </p>
      {rankedStores.some(({ match }) => match?.available) && (
        <p className="mt-2 text-[11.5px] text-sub">相性が高い順に表示しています</p>
      )}

      {stores === null ? (
        <p className="mt-8 text-center text-[13px] text-sub">店舗情報を取得できませんでした</p>
      ) : rankedStores.length === 0 ? (
        <p className="mt-8 text-center text-[13px] text-sub">現在、公開中の店舗はありません。</p>
      ) : (
        <div className="mt-8 space-y-4">
          {rankedStores.map(({ store, match }) => (
            <StoreCard
              key={store.store_id}
              store={store}
              employeeSizeLabel={
                store.employee_size_code ? sizeLabelByCode.get(store.employee_size_code) ?? null : null
              }
              match={match}
            />
          ))}
        </div>
      )}

      <Link href="/stylist/mypage" className="mt-8 block text-center text-[13px] text-sub underline">
        マイページに戻る
      </Link>
    </main>
  );
}
