import Link from "next/link";
import { StoresList, type StoreItem } from "@/components/area/stores-list";
import { ManualRegionForm } from "@/components/area/manual-region-form";
import { fetchStoresForStylistV2, conditionKey, type SearchMode } from "@/lib/area/area-search";
import { fetchActiveRegionRows } from "@/lib/area/region-query";
import { buildRegionTree, todayJst, type RegionNode, type RegionRow } from "@/lib/area/regions";
import { getOwnPreferenceAxes } from "@/lib/matching/actions";

const TAB: { mode: SearchMode; label: string }[] = [{ mode: "near", label: "希望の地域" }, { mode: "all", label: "全国" }, { mode: "manual", label: "地域を指定" }];
const flat = (ns: RegionNode[]): RegionRow[] => ns.flatMap((n) => [{ code: n.code, level: n.level, pref_code: n.pref_code, parent_code: n.parent_code, name: n.name, has_wards: n.has_wards, valid_from: n.valid_from, valid_to: n.valid_to }, ...flat(n.children)]);

/** 美容師: 店舗を探す（地域検索 v2）。並び・地域判定・相性はDBが決める。フラグ AREA_SEARCH_V2=1 のときだけ呼ばれる。 */
export async function AreaStoresBody({ supabase, mode, codes, sizeLabels }: { supabase: unknown; mode: SearchMode; codes: string[]; sizeLabels: Record<string, string> }) {
  const base = "/stylist/salons";
  const needsCodes = mode === "manual" && codes.length === 0;
  const [regions, result, own] = await Promise.all([
    mode === "manual" ? fetchActiveRegionRows(supabase) : Promise.resolve(null),
    needsCodes ? Promise.resolve(null) : fetchStoresForStylistV2(supabase, { mode, regionCodes: codes, limit: 20 }),
    getOwnPreferenceAxes(),
  ]);
  const myMode = result?.ok ? result.page.my_area_mode : null;
  return (
    <div className="mt-6">
      <nav aria-label="探し方" className="flex gap-2">
        {TAB.map((t) => <Link key={t.mode} href={`${base}?mode=${t.mode}`} aria-current={mode === t.mode ? "page" : undefined} className={`rounded-full px-4 py-2 text-[13px] font-semibold ${mode === t.mode ? "bg-ink text-white" : "border border-line text-ink"}`}>{t.label}</Link>)}
      </nav>
      {mode === "near" && myMode === "unset" && (
        <p role="status" className="mt-4 rounded-lg bg-surface2 px-4 py-3 text-[12.5px] leading-relaxed text-charcoal">希望勤務地がまだ設定されていません。<Link href="/stylist/preference/area" className="font-semibold underline">設定する</Link>と、希望の地域や近隣の店舗を先に表示できます。</p>
      )}
      {mode === "manual" && <div className="mt-5">{regions ? <ManualRegionForm rows={flat(buildRegionTree(regions.rows, todayJst()))} initialCodes={codes} basePath={base} /> : <p role="alert" className="rounded-lg bg-surface2 px-4 py-3 text-[13px] text-charcoal">地域の一覧を読み込めませんでした。</p>}</div>}
      {needsCodes ? null : !result?.ok ? (
        <p role="alert" className="mt-8 rounded-lg bg-surface2 px-4 py-3 text-center text-[13px] text-charcoal">{result?.message ?? "店舗情報を取得できませんでした"}</p>
      ) : result.page.items.length === 0 ? (
        <p className="mt-8 text-center text-[13px] leading-relaxed text-sub">{mode === "near" ? "希望の地域・近隣の公開中の店舗は、まだ見つかっていません。『全国』から探すこともできます。" : "条件に合う公開中の店舗はありません。"}</p>
      ) : (
        <div className="mt-8">
          <p className="mb-3 text-[12px] text-sub">{result.page.counts.total}件の店舗（相性が高い順）</p>
          <StoresList key={conditionKey("stylist", mode, codes)} mode={mode} regionCodes={codes} conditionKey={conditionKey("stylist", mode, codes)} initialItems={result.page.items as unknown as StoreItem[]} initialCursor={result.page.next_cursor} sizeLabels={sizeLabels} stylistAxes={own ? own.axes : undefined} />
        </div>
      )}
    </div>
  );
}
