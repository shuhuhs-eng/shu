import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { getStoreScouts, getStoreStylistNameMap } from "@/lib/store-activity/actions";
import { SCOUT_RESPONSE_LABELS } from "@/lib/scouts/options";
import { SCOUT_READ_LABELS, formatJstDateTime } from "@/lib/store-activity/format";
import { StorePageShell } from "@/components/store-activity/store-page-shell";

type Props = {
  params: Promise<{ storeId: string }>;
};

/**
 * 店舗単位スカウト履歴（/salon/stores/[storeId]/scouts、Phase 6）。
 *
 * ★データはget_store_scouts(storeId)のみ。scoutsテーブルの直接SELECTは
 * 「送った本人の分」しか見えないが、このRPCは同じ店舗にアクセスできる
 * 全担当者が送った分を店舗単位で返す。送信者の内部ID(created_by_user_id)は
 * 画面に表示しない。
 */
export default async function StoreScoutsPage({ params }: Props) {
  const { storeId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/salon/stores/${storeId}/scouts`);
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

  const [scouts, names] = await Promise.all([getStoreScouts(storeId), getStoreStylistNameMap(storeId)]);

  return (
    <StorePageShell
      storeId={storeId}
      storeName={store.store_name}
      eyebrow="スカウト履歴"
      description="この店舗から送ったスカウトと、美容師からの返信です。"
    >
      {scouts === null ? (
        <p className="mt-8 text-center text-[13px] text-sub">履歴を取得できませんでした。時間をおいて再度お試しください。</p>
      ) : scouts.length === 0 ? (
        <p className="mt-8 text-center text-[13px] text-sub">まだスカウトを送っていません。</p>
      ) : (
        <div className="mt-8 space-y-3">
          {scouts.map((scout) => (
            <article key={scout.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-serif text-[15px] font-bold text-ink">
                    {names[scout.stylist_user_id] ?? "美容師"}
                  </h3>
                  <p className="mt-1 text-[10.5px] text-sub">{formatJstDateTime(scout.sent_at)} に送信</p>
                </div>
                {scout.matching_score != null && (
                  <div className="shrink-0 rounded-full px-3 py-1.5 text-center" style={{ backgroundColor: "#EAF3EC" }}>
                    <p className="text-[10px] font-semibold text-sub">相性</p>
                    <p className="text-[16px] font-bold leading-none" style={{ color: "#2E8B7F" }}>
                      {scout.matching_score}%
                    </p>
                  </div>
                )}
              </div>

              <p className="mt-3 whitespace-pre-line text-[12.5px] leading-relaxed text-charcoal">{scout.message}</p>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="rounded-full border border-line bg-surface2 px-2.5 py-1 text-charcoal">
                  {SCOUT_READ_LABELS[scout.read_status] ?? scout.read_status}
                </span>
                <span className="rounded-full border border-line bg-surface2 px-2.5 py-1 text-charcoal">
                  {SCOUT_RESPONSE_LABELS[scout.response_status] ?? scout.response_status}
                </span>
                {scout.responded_at && (
                  <span className="text-sub">{formatJstDateTime(scout.responded_at)} に返信</span>
                )}
              </div>

              {scout.response_message && (
                <div className="mt-3 rounded-lg border border-line bg-surface2 p-3">
                  <p className="text-[10px] font-semibold text-sub">美容師からの返信</p>
                  <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-charcoal">
                    {scout.response_message}
                  </p>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </StorePageShell>
  );
}
