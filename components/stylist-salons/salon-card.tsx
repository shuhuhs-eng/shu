import Link from "next/link";
import type { Database } from "@/types/database";
import type { StylistSalonMatchResult } from "@/lib/matching/types";
import { MATCH_AXIS_LABELS } from "@/lib/matching/types";
import type { SalonTypeContent } from "@/lib/salon-culture/salon-culture-types";
import { FavoriteSalonButton } from "@/components/stylist-salons/favorite-salon-button";

type SalonProfileRow = Database["public"]["Tables"]["salon_profiles"]["Row"];

type Props = {
  salon: SalonProfileRow;
  employeeSizeLabel: string | null;
  match: StylistSalonMatchResult | null;
  salonType: SalonTypeContent | null;
  isFavorite: boolean;
};

/**
 * サロンカード（/stylist/salons専用）。既存Beauty Reachのカードデザイン
 * （rounded-2xl border border-line bg-surface）に合わせている。
 *
 * salon_profilesのうち空欄の項目は無理に表示しない。employee_size_code は
 * 呼び出し元（page.tsx）が既存のemployee_size_masterラベル解決ロジックと
 * 同じパターンで解決した結果を受け取るだけで、このコンポーネント自体は
 * ラベル解決を行わない（既存ロジックを変更せず再利用するため）。
 *
 * 相性は「総合スコア」を主役にし、8軸詳細は<details>で折りたたみ、最初から
 * 情報過多にならないようにしている。
 */
export function SalonCard({ salon, employeeSizeLabel, match, salonType, isFavorite }: Props) {
  const location = [salon.prefecture, salon.city].filter(Boolean).join(" ");

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-[17px] font-bold text-ink">{salon.salon_name ?? "サロン"}</h3>
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

      {salonType && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-line bg-surface2 p-3">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-[18px] bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={salonType.characterImagePath}
              alt={salonType.name}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0 text-left">
            <p className="eyebrow mb-1">サロンタイプ</p>
            <p className="font-serif text-[15px] font-bold text-ink">
              <span aria-hidden="true">{salonType.icon}</span>{" "}
              {salonType.name}
            </p>
            <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-sub">
              {salonType.description}
            </p>
          </div>
        </div>
      )}

      {(employeeSizeLabel || (salon.target_specialties && salon.target_specialties.length > 0)) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {employeeSizeLabel && (
            <span className="rounded-full border border-line bg-surface2 px-2.5 py-1 text-[11px] text-charcoal">
              従業員数: {employeeSizeLabel}
            </span>
          )}
          {salon.target_specialties?.map((s) => (
            <span key={s} className="rounded-full border border-line bg-surface2 px-2.5 py-1 text-[11px] text-charcoal">
              {s}
            </span>
          ))}
        </div>
      )}

      {salon.culture_description && (
        <p className="mt-3 text-[13px] leading-relaxed text-charcoal">{salon.culture_description}</p>
      )}
      {!salon.culture_description && salon.bio && (
        <p className="mt-3 text-[13px] leading-relaxed text-charcoal">{salon.bio}</p>
      )}

      {salon.instagram_handle && (
        <p className="mt-2 text-[12px] text-sub">@{salon.instagram_handle}</p>
      )}

      {/* ★「あなたらしさ×サロンらしさ」表示。総合相性を主役にし、8軸詳細は
          折りたたみで、最初から情報過多にならないようにしている。 */}
      <div className="mt-4 border-t border-line pt-4">
        <p className="eyebrow mb-2">あなたらしさ × サロンらしさ</p>

        {match === null && <p className="text-[12.5px] text-sub">相性を確認できませんでした。</p>}

        {match && !match.available && match.reason === "stylist_preference_incomplete" && (
          <p className="text-[12.5px] leading-relaxed text-charcoal">
            働きたいサロン環境を回答すると相性が分かります
          </p>
        )}

        {match && !match.available && (match.reason === "salon_culture_incomplete" || match.reason === "axes_incomplete") && (
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

      <FavoriteSalonButton
        salonUserId={salon.user_id}
        isFavorite={isFavorite}
        className="mt-4"
      />

      {/* ★詳細画面への導線。既存デザイン（枠線・角丸パターン）を保ったまま、
          カード末尾に控えめなテキストリンクとして追加する最小変更。
          カード全体をLinkでラップしないのは、上のdetails要素のクリックと
          干渉させないため。 */}
      <Link
        href={`/stylist/salons/${salon.user_id}`}
        className="mt-4 block text-center text-[12.5px] font-semibold text-ink underline"
      >
        詳細を見る
      </Link>
    </div>
  );
}
