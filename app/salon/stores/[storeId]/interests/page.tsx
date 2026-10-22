import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { getStoreReceivedInterests, getStoreSalaryOffers } from "@/lib/store-activity/actions";
import type { StoreSalaryOffer } from "@/lib/store-activity/types";
import { StorePageShell } from "@/components/store-activity/store-page-shell";
import { StoreInterestCard } from "@/components/store-activity/store-interest-card";
import { getStoreHiringProcesses } from "@/lib/hiring/actions";
import { canManageStoreHiringHint } from "@/lib/hiring/permissions";
import { AddCandidateButton } from "@/components/hiring/add-candidate-button";

type Props = {
  params: Promise<{ storeId: string }>;
};

/**
 * 店舗単位「話を聞きたい美容師」一覧（/salon/stores/[storeId]/interests、Phase 6）。
 *
 * ★アクセス権: layout.tsxと同じく、salon_storesへの直接SELECT（RLS=
 * is_store_accessible）の結果だけで判定する。storeIdは常にURLのparams.storeId。
 *
 * ★データはget_store_received_interests(storeId)のみ（旧
 * get_received_salon_interests / salon_user_id単位は使わない）。同じ店舗に
 * アクセスできる別の担当者への意思表示も、店舗単位で見られる。
 * 給与オファーの履歴(最新の状態判定用)はget_store_salary_offers(storeId)。
 */
export default async function StoreInterestsPage({ params }: Props) {
  const { storeId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/salon/stores/${storeId}/interests`);
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

  // 採用進捗（Phase 8）。登録済みの美容師にはリンク、未登録で書き込み権限があれば追加ボタンを出す。
  const [hiringProcesses, canManageHiring] = await Promise.all([
    getStoreHiringProcesses(storeId),
    canManageStoreHiringHint(supabase, user.id, storeId, store.organization_id),
  ]);
  const hiringProcessByStylist = new Map<string, string>();
  for (const hp of hiringProcesses ?? []) hiringProcessByStylist.set(hp.stylist_user_id, hp.process_id);
  // 一覧を取得できなかった場合は登録済みか判別できないため、追加ボタンは出さない。
  const canShowAddHiring = canManageHiring && hiringProcesses !== null;

  const [interests, offers] = await Promise.all([
    getStoreReceivedInterests(storeId),
    getStoreSalaryOffers(storeId),
  ]);

  // 美容師ごとの最新の給与オファー（get_store_salary_offersは新しい順）。
  const latestOfferByStylist = new Map<string, StoreSalaryOffer>();
  for (const offer of offers ?? []) {
    if (!latestOfferByStylist.has(offer.stylist_user_id)) {
      latestOfferByStylist.set(offer.stylist_user_id, offer);
    }
  }

  return (
    <StorePageShell
      storeId={storeId}
      storeName={store.store_name}
      eyebrow="話を聞きたい美容師"
      description="この店舗に「話を聞いてみたい」を送ってくれた美容師です。プロフィールを確認して、条件を満たす方には給与条件を提示できます。"
    >
      {interests === null ? (
        <p className="mt-8 text-center text-[13px] text-sub">一覧を取得できませんでした。時間をおいて再度お試しください。</p>
      ) : interests.length === 0 ? (
        <p className="mt-8 text-center text-[13px] text-sub">現在、届いている「話を聞いてみたい」はありません。</p>
      ) : (
        <div className="mt-8 space-y-4">
          {interests.map((interest) => (
            <div key={interest.interest_id}>
              <StoreInterestCard
                storeId={storeId}
                interest={interest}
                latestOffer={latestOfferByStylist.get(interest.stylist_user_id) ?? null}
              />
              <AddCandidateButton
                storeId={storeId}
                stylistUserId={interest.stylist_user_id}
                processId={hiringProcessByStylist.get(interest.stylist_user_id) ?? null}
                canManage={canShowAddHiring}
              />
            </div>
          ))}
        </div>
      )}
    </StorePageShell>
  );
}
