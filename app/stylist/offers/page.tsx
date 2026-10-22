import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { loadStylistOfferGroups } from "@/lib/stylist-inbox/load";
import { getUnreadNotificationRefs } from "@/lib/notifications/get-notifications";
import { StylistOfferCard } from "@/components/salary-offers/stylist-offer-card";

/**
 * 美容師の「届いたオファー（給与条件）」一覧（Phase 7）。
 * 本人宛(stylist_user_id = 自分)のみ。店舗ごとに1カード（最新の提示が回答対象、
 * 過去分は折りたたみで閲覧のみ）。回答は既存のrespond_salary_offer（offer_idと
 * 本人確認・回答待ちのみ更新可）で、回答済みのオファーには再回答できない。
 */
export default async function StylistOffersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/stylist/offers");
  }

  if (!(await hasCompletedRole(supabase, user.id, "stylist"))) {
    redirect("/onboarding");
  }

  const groups = await loadStylistOfferGroups(supabase, user.id);
  const unreadRefs = await getUnreadNotificationRefs(supabase, user.id);

  // カード単位の未読バッジ: 通知のrelated_entity_id(=salary_offers.id)を、
  // その店舗のオファーID群(最新+履歴)と突き合わせる。
  const cards = groups.map((g) => {
    const offerIds = new Set([g.latest, ...g.history].map((o) => o.id));
    return {
      group: g,
      unreadCount: unreadRefs.filter(
        (r) => r.related_entity_type === "salary_offer" && r.related_entity_id && offerIds.has(r.related_entity_id),
      ).length,
      notificationEntities: [...offerIds].map((id) => ({ type: "salary_offer", id })),
    };
  });

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <Link href="/stylist/mypage" className="text-[13px] font-semibold text-sub underline">
        ← マイページに戻る
      </Link>

      <p className="eyebrow mb-2 mt-5">届いたオファー</p>
      <h1 className="font-serif text-2xl font-bold text-ink">店舗・サロンからの給与条件</h1>

      {cards.length === 0 ? (
        <p className="mt-8 text-center text-[13px] text-sub">まだ給与条件は届いていません。</p>
      ) : (
        <div className="mt-6 space-y-3">
          {cards.map(({ group: g, unreadCount, notificationEntities }) => (
            <StylistOfferCard
              key={g.key}
              offer={g.latest}
              salonName={g.sourceName}
              history={g.history}
              unreadCount={unreadCount}
              notificationEntities={notificationEntities}
              storeId={g.storeId}
              area={g.area}
            />
          ))}
        </div>
      )}

      <Link
        href="/stylist/salons"
        className="mt-8 flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-3.5 text-[14px] font-semibold text-ink"
      >
        公開中の店舗を探す
      </Link>
    </main>
  );
}
