import Link from "next/link";
import { CandidatesList, type CandidateItem } from "@/components/area/candidates-list";
import { ManualRegionForm } from "@/components/area/manual-region-form";
import { fetchScoutCandidatesV2, nearEmptyMessage, conditionKey, type SearchMode } from "@/lib/area/area-search";
import { enrichCandidates } from "@/lib/area/enrich";
import { fetchActiveRegionRows } from "@/lib/area/region-query";
import { buildRegionTree, todayJst, type RegionNode, type RegionRow } from "@/lib/area/regions";
import { CANDIDATE_LOAD_FAILED_MESSAGE, CANDIDATE_EMPTY_MESSAGE } from "@/lib/scouts/candidate-load";

type Props = { supabase: unknown; storeId: string; mode: SearchMode; codes: string[]; canManage: boolean; recruitingPaused: boolean };
const TAB: { mode: SearchMode; label: string }[] = [{ mode: "near", label: "近隣" }, { mode: "all", label: "全国" }, { mode: "manual", label: "地域を指定" }];
const flat = (ns: RegionNode[]): RegionRow[] => ns.flatMap((n) => [{ code: n.code, level: n.level, pref_code: n.pref_code, parent_code: n.parent_code, name: n.name, has_wards: n.has_wards, valid_from: n.valid_from, valid_to: n.valid_to }, ...flat(n.children)]);

/** 美容師を探す（地域検索 v2）。並び・地域判定・相性はDBが決める。機能フラグ AREA_SEARCH_V2=1 のときだけ呼ばれる。 */
export async function AreaCandidatesBody({ supabase, storeId, mode, codes, canManage, recruitingPaused }: Props) {
  const base = `/salon/stores/${storeId}/stylists`;
  const manualNeedsCodes = mode === "manual" && codes.length === 0;
  const regions = mode === "manual" ? await fetchActiveRegionRows(supabase) : null;
  const result = manualNeedsCodes ? null : await fetchScoutCandidatesV2(supabase, { storeId, mode, regionCodes: codes, limit: 20 });
  const extra = result?.ok ? await enrichCandidates(storeId, result.page.items as unknown as { stylist_user_id: string; avatar_path?: string | null }[]) : null;

  return (
    <div className="mt-6">
      <nav aria-label="探し方" className="flex gap-2">
        {TAB.map((t) => (
          <Link key={t.mode} href={`${base}?mode=${t.mode}`} aria-current={mode === t.mode ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-[13px] font-semibold ${mode === t.mode ? "bg-ink text-white" : "border border-line text-ink"}`}>{t.label}</Link>
        ))}
      </nav>

      {result?.ok && result.page.store_region.status !== "confirmed" && mode !== "all" && (
        <p role="status" className="mt-4 rounded-lg bg-surface2 px-4 py-3 text-[12.5px] leading-relaxed text-charcoal">
          {result.page.store_region.status === "stale" ? "店舗の住所が変更されたため、所在地の確認が必要です。" : "この店舗の所在地（市区）が未確認のため、地域との一致は判定できません。"}
          {canManage && <> <Link href={`/salon/stores/${storeId}/region`} className="font-semibold underline">所在地を確認する</Link></>}
        </p>
      )}

      {mode === "manual" && (
        <div className="mt-5">
          {regions ? <ManualRegionForm rows={flat(buildRegionTree(regions.rows, todayJst()))} initialCodes={codes} basePath={base} />
            : <p role="alert" className="rounded-lg bg-surface2 px-4 py-3 text-[13px] text-charcoal">地域の一覧を読み込めませんでした。</p>}
        </div>
      )}

      {manualNeedsCodes ? null : !result?.ok ? (
        <p role="alert" className="mt-8 rounded-lg bg-surface2 px-4 py-3 text-center text-[13px] text-charcoal">{result?.message || CANDIDATE_LOAD_FAILED_MESSAGE}</p>
      ) : result.page.items.length === 0 ? (
        <p className="mt-8 text-center text-[13px] leading-relaxed text-sub">{mode === "near" ? nearEmptyMessage() : CANDIDATE_EMPTY_MESSAGE}</p>
      ) : (
        <div className="mt-8">
          <p className="mb-3 text-[12px] text-sub">{result.page.counts.total}人が見つかりました（相性が高い順）</p>
          <CandidatesList key={conditionKey(storeId, mode, codes)} storeId={storeId} mode={mode} regionCodes={codes} conditionKey={conditionKey(storeId, mode, codes)}
            initialItems={result.page.items as unknown as CandidateItem[]} initialCursor={result.page.next_cursor}
            avatarUrls={extra?.avatarUrls ?? {}} latestScouts={extra?.latestScouts ?? {}} recruitingPaused={recruitingPaused} canManage={canManage} />
        </div>
      )}
    </div>
  );
}
