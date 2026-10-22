import Link from "next/link";
import type { StylistStoreMatchResult } from "@/lib/matching/types";
import { MATCH_AXIS_LABELS } from "@/lib/matching/types";
import type { PublicSalonStore } from "@/lib/store-activity/types";

type Props = {
  store: PublicSalonStore;
  employeeSizeLabel: string | null;
  match: StylistStoreMatchResult | null;
};

/**
 * 公開中の店舗カード（/stylist/salons、店舗単位）。既存SalonCardと同じ
 * カードデザイン（rounded-2xl border border-line bg-surface）を踏襲する。
 * 詳細へのリンクはstore_id（RPC結果由来）のみを使う。
 */
export function StoreCard({ store, employeeSizeLabel, match }: Props) {
  const location = [store.prefecture, store.city].filter(Boolean).join(" ");

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-[17px] font-bold text-ink">{store.store_name}</h3>
          {location && <p className="mt-1 text-[12.5px] text-sub">{location}</p>}
        </div>
        {match?.available && (
          <div className="shrink-0 rounded-full px-3 py-1.5 text-center" style={{ backgroundColor: "#EAF3EC" }}>
            <p className="text-[10px] font-semibold text-sub">相性</p>
            <p className="text-[18px] font-bold leading-none" style={{ color: "#2E8B7F" }}>
              {match.overall_score}%
            </p>
          </div>
        )}
      </div>

      {(employeeSizeLabel || store.target_specialties.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {employeeSizeLabel && (
            <span className="rounded-full border border-line bg-surface2 px-2.5 py-1 text-[11px] text-charcoal">
              従業員数: {employeeSizeLabel}
            </span>
          )}
          {store.target_specialties.map((s) => (
            <span key={s} className="rounded-full border border-line bg-surface2 px-2.5 py-1 text-[11px] text-charcoal">
              {s}
            </span>
          ))}
        </div>
      )}

      {store.bio && <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed text-charcoal">{store.bio}</p>}

      <div className="mt-4 border-t border-line pt-4">
        <p className="eyebrow mb-2">あなたとの相性</p>

        {match === null && <p className="text-[12.5px] text-sub">相性を確認できませんでした。</p>}

        {match && !match.available && match.reason === "stylist_preference_incomplete" && (
          <p className="text-[12.5px] leading-relaxed text-charcoal">
            働きたいサロン環境を回答すると相性が分かります
          </p>
        )}

        {match && !match.available && match.reason !== "stylist_preference_incomplete" && (
          <p className="text-[12.5px] leading-relaxed text-sub">相性診断準備中</p>
        )}

        {match?.available && (
          <details>
            <summary className="cursor-pointer text-[12.5px] font-semibold text-ink underline">
              8つの軸で見る
            </summary>
            <ul className="mt-3 space-y-2">
              {(Object.keys(MATCH_AXIS_LABELS) as (keyof typeof MATCH_AXIS_LABELS)[]).map((key) => (
                <li key={key} className="flex items-center justify-between gap-3 text-[12.5px] text-charcoal">
                  <span>{MATCH_AXIS_LABELS[key]}</span>
                  <span className="font-semibold text-ink">{match.axis_scores[key]}%</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <Link
        href={`/stylist/salons/${store.store_id}`}
        className="mt-4 block text-center text-[12.5px] font-semibold text-ink underline"
      >
        詳細を見る
      </Link>
    </div>
  );
}
