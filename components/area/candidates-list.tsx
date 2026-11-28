"use client";

import { useState, useTransition } from "react";
import { StoreStylistCard } from "@/components/scouts/store-stylist-card";
import { loadMoreCandidatesAction } from "@/lib/area/actions";
import { AREA_BADGE_LABEL, appendPage, emptyPager, toMatchResult, type AreaBadge, type PagerState } from "@/lib/area/area-search";
import type { PublicStylistForScout } from "@/lib/scouts/types";
import type { StoreStylistMatchResult } from "@/lib/matching/types";
import type { LatestScoutLite } from "@/lib/area/enrich";

export type CandidateItem = PublicStylistForScout & { match: unknown; area_badge: AreaBadge; area_slot: "main" | "unconfirmed"; sort_score: number };
type Props = {
  storeId: string; mode: "near" | "all" | "manual"; regionCodes: string[]; conditionKey: string;
  initialItems: CandidateItem[]; initialCursor: string | null;
  avatarUrls: Record<string, string>; latestScouts: Record<string, LatestScoutLite>;
  recruitingPaused: boolean; canManage: boolean;
};

/** サロン: 候補一覧（スロット順・相性順はDBが決める。ここでは並べ替えない）。「さらに表示」は続きのカーソルを使う。 */
export function CandidatesList({ storeId, mode, regionCodes, conditionKey, initialItems, initialCursor, avatarUrls: a0, latestScouts: l0, recruitingPaused, canManage }: Props) {
  const [pager, setPager] = useState<PagerState<CandidateItem>>({ ...emptyPager<CandidateItem>(conditionKey), items: initialItems, nextCursor: initialCursor, exhausted: !initialCursor });
  const [avatars, setAvatars] = useState(a0);
  const [latest, setLatest] = useState(l0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function more() {
    if (!pager.nextCursor) return;
    setError(null);
    start(async () => {
      const r = await loadMoreCandidatesAction({ storeId, mode, regionCodes: mode === "manual" ? regionCodes : undefined, cursor: pager.nextCursor as string });
      if (!r.success) { setError(r.error); return; }
      setPager((s) => appendPage(s, conditionKey, { items: r.items as CandidateItem[], next_cursor: r.nextCursor }));
      setAvatars((a) => ({ ...a, ...(r.avatarUrls ?? {}) })); setLatest((l) => ({ ...l, ...(r.latestScouts ?? {}) }));
    });
  }

  const main = pager.items.filter((i) => i.area_slot === "main");
  const unconfirmed = pager.items.filter((i) => i.area_slot === "unconfirmed");
  const card = (s: CandidateItem) => (
    <div key={s.stylist_user_id}>
      {s.area_badge && <p className="mb-1.5 inline-block rounded-full bg-surface2 px-3 py-1 text-[11.5px] font-semibold text-charcoal">{AREA_BADGE_LABEL[s.area_badge]}</p>}
      <StoreStylistCard storeId={storeId} stylist={s} avatarUrl={avatars[s.stylist_user_id] ?? null} match={toMatchResult(s.match) as StoreStylistMatchResult | null}
        latestScout={(latest[s.stylist_user_id] as unknown as Parameters<typeof StoreStylistCard>[0]["latestScout"]) ?? null} recruitingPaused={recruitingPaused} canManage={canManage} />
    </div>
  );
  return (
    <div>
      <div className="space-y-4">{main.map(card)}</div>
      {unconfirmed.length > 0 && (
        <section className="mt-8" aria-label="詳細未確認">
          <h2 className="text-[13px] font-semibold text-ink">希望勤務地の詳細が未確認の美容師</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-sub">この店舗の所在地が未確認のため、地域との一致は判定していません。</p>
          <div className="mt-3 space-y-4">{unconfirmed.map(card)}</div>
        </section>
      )}
      {error && <p role="alert" className="mt-4 text-center text-[13px] text-red-700">{error}</p>}
      {pager.nextCursor && (
        <button type="button" onClick={more} disabled={pending} className="mt-6 w-full rounded-full border border-line px-5 py-3 text-[13.5px] font-semibold text-ink disabled:opacity-50">{pending ? "読み込み中…" : "さらに表示"}</button>
      )}
    </div>
  );
}
