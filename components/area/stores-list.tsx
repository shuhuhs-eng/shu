"use client";

import { useState, useTransition } from "react";
import { StoreCard } from "@/components/stylist-salons/store-card";
import { loadMoreStoresAction } from "@/lib/area/actions";
import { AREA_BADGE_LABEL, appendPage, emptyPager, toMatchResult, type AreaBadge, type PagerState } from "@/lib/area/area-search";
import type { PublicSalonStore } from "@/lib/store-activity/types";
import type { StylistStoreMatchResult } from "@/lib/matching/types";

export type StoreItem = PublicSalonStore & { match: unknown; area_badge: AreaBadge; area_slot: "main" | "unconfirmed"; sort_score: number };
type Props = {
  mode: "near" | "all" | "manual"; regionCodes: string[]; conditionKey: string; initialItems: StoreItem[]; initialCursor: string | null;
  sizeLabels: Record<string, string>; stylistAxes?: unknown;
};

/** 美容師: 店舗一覧（並びはDBが決める）。「さらに表示」は続きのカーソルを使う。 */
export function StoresList({ mode, regionCodes, conditionKey, initialItems, initialCursor, sizeLabels, stylistAxes }: Props) {
  const [pager, setPager] = useState<PagerState<StoreItem>>({ ...emptyPager<StoreItem>(conditionKey), items: initialItems, nextCursor: initialCursor, exhausted: !initialCursor });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function more() {
    if (!pager.nextCursor) return;
    setError(null);
    start(async () => {
      const r = await loadMoreStoresAction({ mode, regionCodes: mode === "manual" ? regionCodes : undefined, cursor: pager.nextCursor as string });
      if (!r.success) { setError(r.error); return; }
      setPager((s) => appendPage(s, conditionKey, { items: r.items as StoreItem[], next_cursor: r.nextCursor }));
    });
  }
  const card = (s: StoreItem) => (
    <div key={s.store_id}>
      {s.area_badge && <p className="mb-1.5 inline-block rounded-full bg-surface2 px-3 py-1 text-[11.5px] font-semibold text-charcoal">{AREA_BADGE_LABEL[s.area_badge]}</p>}
      <StoreCard store={s} employeeSizeLabel={s.employee_size_code ? sizeLabels[s.employee_size_code] ?? null : null} match={toMatchResult(s.match) as StylistStoreMatchResult | null} stylistAxes={stylistAxes} />
    </div>
  );
  const main = pager.items.filter((i) => i.area_slot === "main"); const unconfirmed = pager.items.filter((i) => i.area_slot === "unconfirmed");
  return (
    <div>
      <div className="space-y-4">{main.map(card)}</div>
      {unconfirmed.length > 0 && (
        <section className="mt-8" aria-label="所在地が未確認の店舗">
          <h2 className="text-[13px] font-semibold text-ink">所在地が未確認の店舗</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-sub">店舗の所在地が未確認のため、希望の地域との一致は判定していません。</p>
          <div className="mt-3 space-y-4">{unconfirmed.map(card)}</div>
        </section>
      )}
      {error && <p role="alert" className="mt-4 text-center text-[13px] text-red-700">{error}</p>}
      {pager.nextCursor && <button type="button" onClick={more} disabled={pending} className="mt-6 w-full rounded-full border border-line px-5 py-3 text-[13.5px] font-semibold text-ink disabled:opacity-50">{pending ? "読み込み中…" : "さらに表示"}</button>}
    </div>
  );
}
