import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { getStoreSalaryOffers, getStoreStylistNameMap } from "@/lib/store-activity/actions";
import {
  SALARY_OFFER_REASON_LABELS,
  SALARY_OFFER_STATUS_LABELS,
  formatJstDateTime,
} from "@/lib/store-activity/format";
import { StorePageShell } from "@/components/store-activity/store-page-shell";

type Props = {
  params: Promise<{ storeId: string }>;
};

/**
 * 店舗単位の給与オファー履歴（/salon/stores/[storeId]/offers、Phase 6）。
 *
 * ★データはget_store_salary_offers(storeId)のみ。salary_offersの直接SELECTは
 * 「提示した本人の分」しか見えないが、このRPCは同じ店舗にアクセスできる
 * 全担当者が出した分を店舗単位で返す。提示者の内部ID(created_by_user_id)は
 * 画面に表示しない。新規の提示は「話を聞きたい美容師」の画面から行う。
 */
export default async function StoreOffersPage({ params }: Props) {
  const { storeId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/salon/stores/${storeId}/offers`);
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

  const [offers, names] = await Promise.all([getStoreSalaryOffers(storeId), getStoreStylistNameMap(storeId)]);

  return (
    <StorePageShell
      storeId={storeId}
      storeName={store.store_name}
      eyebrow="オファー履歴"
      description="この店舗から提示した給与条件と、美容師からの回答です。"
    >
      {offers === null ? (
        <p className="mt-8 text-center text-[13px] text-sub">履歴を取得できませんでした。時間をおいて再度お試しください。</p>
      ) : offers.length === 0 ? (
        <p className="mt-8 text-center text-[13px] text-sub">まだ給与条件を提示していません。</p>
      ) : (
        <div className="mt-8 space-y-3">
          {offers.map((offer) => (
            <article key={offer.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-serif text-[15px] font-bold text-ink">
                    {names[offer.stylist_user_id] ?? "美容師"}
                  </h3>
                  <p className="mt-1 text-[10.5px] text-sub">{formatJstDateTime(offer.created_at)} に提示</p>
                </div>
                <span className="shrink-0 rounded-full border border-line bg-surface2 px-3 py-1 text-[11px] font-semibold text-charcoal">
                  {SALARY_OFFER_STATUS_LABELS[offer.status] ?? offer.status}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-surface2 p-2">
                  <p className="text-[10px] text-sub">月額保証</p>
                  <p className="mt-1 text-[13px] font-bold">{offer.monthly_guarantee.toLocaleString()}円</p>
                </div>
                <div className="rounded-lg bg-surface2 p-2">
                  <p className="text-[10px] text-sub">実績加算</p>
                  <p className="mt-1 text-[13px] font-bold">{offer.performance_addition.toLocaleString()}円</p>
                </div>
                <div className="rounded-lg bg-surface2 p-2">
                  <p className="text-[10px] text-sub">保証期間</p>
                  <p className="mt-1 text-[13px] font-bold">{offer.guarantee_months}か月</p>
                </div>
              </div>

              {offer.performance_addition > 0 && (
                <div className="mt-3 rounded-lg border border-line bg-surface2 p-3">
                  <p className="text-[10px] font-semibold text-sub">支給条件</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-charcoal">
                    {offer.performance_condition ?? "未記載"}
                  </p>
                </div>
              )}

              {offer.salon_message && (
                <p className="mt-3 whitespace-pre-line text-[12px] leading-relaxed text-charcoal">{offer.salon_message}</p>
              )}

              {offer.status !== "pending" && (
                <div className="mt-3 rounded-lg border border-line bg-surface2 p-3 text-[12px] text-charcoal">
                  <p className="text-[10px] font-semibold text-sub">
                    美容師からの回答
                    {offer.responded_at && `（${formatJstDateTime(offer.responded_at)}）`}
                  </p>
                  <p className="mt-1 font-semibold">{SALARY_OFFER_STATUS_LABELS[offer.status] ?? offer.status}</p>
                  {offer.response_reason && (
                    <p className="mt-1 text-sub">
                      相談したい項目: {SALARY_OFFER_REASON_LABELS[offer.response_reason] ?? "その他"}
                    </p>
                  )}
                  {offer.response_note && (
                    <p className="mt-1 whitespace-pre-line leading-relaxed">{offer.response_note}</p>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </StorePageShell>
  );
}
