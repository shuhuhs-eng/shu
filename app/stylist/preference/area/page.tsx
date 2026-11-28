import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { areaSearchV2Enabled } from "@/lib/area/feature-flag";
import { fetchMyAreaPreference, areaErrorMessage } from "@/lib/area/area-search";
import { fetchActiveRegionRows } from "@/lib/area/region-query";
import { buildRegionTree, todayJst, type RegionRow } from "@/lib/area/regions";
import { AreaPreferenceForm } from "@/components/area/area-preference-form";

// 機能フラグ(実行時の環境変数)で表示を切り替えるため、ビルド時に固定（静的化）させない。
export const dynamic = "force-dynamic";

/** 美容師: 希望勤務地の設定（地域検索 v2。機能フラグ AREA_SEARCH_V2=1 のときだけ表示）。 */
export default async function StylistAreaPreferencePage() {
  if (!areaSearchV2Enabled()) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/stylist/preference/area");
  if (!(await hasCompletedRole(supabase, user.id, "stylist"))) redirect("/onboarding");

  const [pref, regions] = await Promise.all([fetchMyAreaPreference(supabase), fetchActiveRegionRows(supabase)]);
  const flat: RegionRow[] = regions ? flatten(buildRegionTree(regions.rows, todayJst())) : [];
  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <p className="eyebrow mb-2">希望勤務地</p>
      <h1 className="font-serif text-2xl font-bold text-ink">働きたい地域を設定する</h1>
      <p className="mt-3 text-[13px] leading-relaxed text-charcoal">設定した地域は、近隣で美容師を探しているサロンの検索に使われます。個人の住所は使いません。</p>
      {!pref.ok ? (
        <p role="alert" className="mt-8 rounded-lg bg-surface2 px-4 py-3 text-[13px] text-charcoal">{pref.message || areaErrorMessage(null)}</p>
      ) : !regions ? (
        <p role="alert" className="mt-8 rounded-lg bg-surface2 px-4 py-3 text-[13px] text-charcoal">地域の一覧を読み込めませんでした。時間をおいて、もう一度お試しください。</p>
      ) : (
        <div className="mt-8">
          <AreaPreferenceForm rows={flat} initialMode={pref.pref.mode} initialCodes={pref.pref.items.filter((i) => !i.needs_review).map((i) => i.code)} initialRevision={pref.pref.revision} needsReview={pref.pref.needs_review === true || pref.pref.items.some((i) => i.needs_review)} />
        </div>
      )}
      <Link href="/stylist/mypage" className="mt-8 block text-center text-[13px] text-sub underline">マイページに戻る</Link>
    </main>
  );
}
function flatten(nodes: ReturnType<typeof buildRegionTree>): RegionRow[] {
  return nodes.flatMap((n) => [{ code: n.code, level: n.level, pref_code: n.pref_code, parent_code: n.parent_code, name: n.name, has_wards: n.has_wards, valid_from: n.valid_from, valid_to: n.valid_to }, ...flatten(n.children)]);
}
