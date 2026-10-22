import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { loadStylistScoutGroups } from "@/lib/stylist-inbox/load";
import { StylistScoutCard } from "@/components/scouts/stylist-scout-card";

/**
 * 美容師の「届いたスカウト」一覧（Phase 7）。
 * 本人宛(stylist_user_id = 自分)のみ。店舗ごとに1カードで、どの店舗から
 * 届いたかを表示し、公開中の店舗なら「店舗を見る」から店舗詳細へ移動できる。
 * 開封（既読化）・返信は既存のmark_scout_read / respond_scoutのまま。
 */
export default async function StylistScoutsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/stylist/scouts");
  }

  if (!(await hasCompletedRole(supabase, user.id, "stylist"))) {
    redirect("/onboarding");
  }

  const groups = await loadStylistScoutGroups(supabase, user.id);

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <Link href="/stylist/mypage" className="text-[13px] font-semibold text-sub underline">
        ← マイページに戻る
      </Link>

      <p className="eyebrow mb-2 mt-5">届いたスカウト</p>
      <h1 className="font-serif text-2xl font-bold text-ink">店舗・サロンからのスカウト</h1>

      {groups.length === 0 ? (
        <p className="mt-8 text-center text-[13px] text-sub">まだスカウトは届いていません。</p>
      ) : (
        <div className="mt-6 space-y-3">
          {groups.map((g) => (
            <StylistScoutCard
              key={g.key}
              scout={g.latest}
              salonName={g.sourceName}
              history={g.history}
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
