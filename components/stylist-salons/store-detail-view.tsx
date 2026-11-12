import { deriveSalonTypes, SALON_TYPE_CONTENT } from "@/lib/salon-culture/salon-culture-types";
import { SALON_VALUE_PRIORITY_OPTIONS } from "@/lib/validation/profile-options";
import type { PublicSalonStoreDetail } from "@/lib/store-activity/types";

/**
 * 美容師向け店舗詳細の表示部品（/stylist/salons/[storeId] と、サロン側の
 * 「美容師からの見え方（プレビュー）」で共用する）。表示専用で、データ取得・操作・副作用は持たない。
 *
 * ★culture_axes（12軸の生数値）はここでタイプ名の算出にだけ使い、JSXには
 *   算出済みのタイプ名・説明だけを埋め込む。
 * ★「相性」セクションは美容師ごとに変わるため、呼び出し側が matchSection として渡す
 *   （美容師画面は計算結果、プレビューは「美容師の回答によって変わります」の案内）。
 */
export type StoreDetailViewData = Pick<
  PublicSalonStoreDetail,
  | "store_name"
  | "prefecture"
  | "city"
  | "street_address"
  | "culture_description"
  | "employee_size_code"
  | "target_specialties"
  | "bio"
  | "hotpepper_url"
  | "culture"
>;

type Props = {
  store: StoreDetailViewData;
  employeeSizeLabel: string | null;
  matchSection: React.ReactNode;
};

export function StoreDetailView({ store, employeeSizeLabel, matchSection }: Props) {
  const culture = store.culture;
  const classification = culture?.culture_axes ? deriveSalonTypes(culture.culture_axes) : null;
  const location = [store.prefecture, store.city].filter(Boolean).join(" ");

  return (
    <>
      <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
        <h1 className="font-serif text-2xl font-bold text-ink">{store.store_name}</h1>
        {location && <p className="mt-1 text-[13px] text-sub">{location}</p>}
        {store.street_address && <p className="mt-1 text-[12.5px] text-sub">{store.street_address}</p>}

        {(employeeSizeLabel || store.target_specialties.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-2">
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

        {store.bio && <p className="mt-4 text-[13.5px] leading-relaxed text-charcoal">{store.bio}</p>}
        {store.culture_description && (
          <p className="mt-4 text-[13.5px] leading-relaxed text-charcoal">{store.culture_description}</p>
        )}
      </section>

      {culture?.comment && (
        <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
          <p className="eyebrow mb-3">店舗からの一言</p>
          <p className="text-[13.5px] leading-relaxed text-charcoal">{culture.comment}</p>
        </section>
      )}

      {matchSection}

      <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
        <p className="eyebrow mb-3">この店舗のタイプ</p>

        {!culture && (
          <p className="text-[12.5px] leading-relaxed text-charcoal">サロンらしさは現在準備中です</p>
        )}

        {culture && classification && (
          <div>
            <div className="text-center">
              <div className="mx-auto h-44 w-full max-w-[220px] overflow-hidden rounded-[28px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={SALON_TYPE_CONTENT[classification.mainType].characterImagePath}
                  alt={SALON_TYPE_CONTENT[classification.mainType].name}
                  className="h-full w-full object-contain"
                />
              </div>
              <p className="mt-2 font-serif text-[20px] font-bold text-ink">
                {SALON_TYPE_CONTENT[classification.mainType].name}
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-charcoal">
                {SALON_TYPE_CONTENT[classification.mainType].description}
              </p>
            </div>

            <div className="mt-5 border-t border-line pt-4 text-center">
              <p className="eyebrow mb-2">サブタイプ</p>
              <p className="text-[14px] font-semibold text-ink">
                <span aria-hidden="true">{SALON_TYPE_CONTENT[classification.subType].icon}</span>{" "}
                {SALON_TYPE_CONTENT[classification.subType].name}
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-sub">
                {SALON_TYPE_CONTENT[classification.subType].description}
              </p>
            </div>
          </div>
        )}
      </section>

      {culture?.value_priorities && culture.value_priorities.length > 0 && (
        <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
          <p className="eyebrow mb-3">今、大切にしている価値観</p>
          <ol className="list-decimal space-y-1 pl-5 text-[13.5px] leading-relaxed text-charcoal">
            {culture.value_priorities.map((code) => {
              const opt = SALON_VALUE_PRIORITY_OPTIONS.find((o) => o.code === code);
              return <li key={code}>{opt?.label ?? code}</li>;
            })}
          </ol>
        </section>
      )}

      {culture?.ai_summary && (
        <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
          <p className="eyebrow mb-3">AIによる店舗紹介</p>
          <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-charcoal">{culture.ai_summary}</p>
        </section>
      )}

      {store.hotpepper_url && (
        <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
          <p className="eyebrow mb-3">この店舗をもっと見る</p>
          <a
            href={store.hotpepper_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center rounded-full border border-line bg-surface2 px-6 py-3.5 text-[13.5px] font-semibold text-ink"
          >
            ホットペッパービューティーを見る
          </a>
        </section>
      )}
    </>
  );
}
