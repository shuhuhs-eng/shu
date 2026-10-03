import Link from "next/link";
import { SALON_VALUE_PRIORITY_OPTIONS } from "@/lib/validation/profile-options";
import { deriveIdealFitDescriptions } from "@/lib/salon-culture/culture-display";
import {
  deriveSalonTypes,
  deriveTopCharacteristics,
  SALON_TYPE_CONTENT,
} from "@/lib/salon-culture/salon-culture-types";
import type { Database } from "@/types/database";

type Props = {
  storeId: string;
  profile: Database["public"]["Tables"]["salon_store_culture_profiles"]["Row"];
};

/**
 * 店舗単位「サロンらしさ」結果画面（法人・複数店舗対応 Phase 3B）。
 *
 * ★既存components/salon-culture/culture-result.tsxの見た目・派生ロジック
 * （lib/salon-culture/salon-culture-types.ts・lib/salon-culture/culture-display.ts、
 * いずれも読み取り専用の純粋関数で変更していない）をそのまま再現している。
 * 差分はPropsの型（store_id起点の行）と、リンク先が
 * /salon/stores/[storeId]/culture系であることのみ。既存culture-result.tsx
 * 自体は一切変更していない。
 */
export function StoreCultureResult({ storeId, profile }: Props) {
  const axes = profile.culture_axes ?? {};
  const classification = deriveSalonTypes(axes);
  const characteristics = deriveTopCharacteristics(axes);
  const idealFit = deriveIdealFitDescriptions(axes);

  return (
    <div className="space-y-6">
      {classification ? (
        <section className="rounded-2xl border border-line bg-surface p-6 text-center">
          <p className="eyebrow mb-2">このサロンタイプは</p>
          <div className="mx-auto mt-3 h-56 w-full max-w-[280px] overflow-hidden rounded-[32px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={SALON_TYPE_CONTENT[classification.mainType].characterImagePath}
              alt={SALON_TYPE_CONTENT[classification.mainType].name}
              className="h-full w-full object-contain"
            />
          </div>
          <h1 className="mt-2 font-serif text-2xl font-bold text-ink">
            {SALON_TYPE_CONTENT[classification.mainType].name}
          </h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-charcoal">
            {SALON_TYPE_CONTENT[classification.mainType].description}
          </p>

          <div className="mt-5 border-t border-line pt-5">
            <p className="eyebrow mb-2">サブタイプ</p>
            <p className="text-[15px] font-semibold text-ink">
              <span aria-hidden="true">{SALON_TYPE_CONTENT[classification.subType].icon}</span>{" "}
              {SALON_TYPE_CONTENT[classification.subType].name}
            </p>
          </div>

          {characteristics && characteristics.length > 0 && (
            <div className="mt-6 border-t border-line pt-5 text-left">
              <p className="eyebrow mb-3 text-center">このサロンの特徴</p>
              <ul className="space-y-1.5 text-[13.5px] leading-relaxed text-charcoal">
                {characteristics.map((text, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span aria-hidden="true" className="text-[var(--gold)]">
                      ・
                    </span>
                    {text}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-center text-[11.5px] text-sub">
                数値の大小は良し悪しではなく、サロンの特徴です
              </p>
            </div>
          )}
        </section>
      ) : (
        <section className="rounded-2xl border border-line bg-surface2 p-6 text-center">
          <p className="text-[13.5px] leading-relaxed text-charcoal">
            サロンらしさを更新すると、
            <br />
            新しいサロンタイプが表示されます。
          </p>
          <div className="mt-5 flex flex-col items-center gap-3">
            <Link
              href={`/salon/stores/${storeId}/culture?edit=1`}
              className="flex w-full max-w-[280px] items-center justify-center rounded-full bg-ink px-6 py-3 text-[14px] font-semibold text-surface"
            >
              サロンらしさを更新する
            </Link>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-dashed border-[var(--gold)]/50 bg-surface2 p-6 text-center">
        <p className="eyebrow mb-2" style={{ color: "var(--gold)" }}>
          Coming soon
        </p>
        <h2 className="font-serif text-lg font-bold text-ink">あなたらしさ × サロンらしさ</h2>
        <p className="mt-3 text-[13px] leading-relaxed text-charcoal">
          あなたの才能・価値観・働き方と、
          <br />
          このサロンのらしさを掛け合わせた相性診断は、
          <br />
          マッチング機能とともに表示される予定です。
        </p>
      </section>

      {profile.value_priorities && profile.value_priorities.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-6">
          <p className="eyebrow mb-3">今、大切にしている価値観</p>
          <ol className="list-decimal space-y-1 pl-5 text-[13.5px] leading-relaxed text-charcoal">
            {profile.value_priorities.map((code) => {
              const opt = SALON_VALUE_PRIORITY_OPTIONS.find((o) => o.code === code);
              return <li key={code}>{opt?.label ?? code}</li>;
            })}
          </ol>

          {idealFit.length > 0 && (
            <div className="mt-5 border-t border-line pt-5">
              <p className="eyebrow mb-3">このサロンで活躍しやすい人</p>
              <ul className="list-disc space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-charcoal">
                {idealFit.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {profile.comment && (
        <section className="rounded-2xl border border-line bg-surface p-6">
          <p className="eyebrow mb-3">サロンの雰囲気について</p>
          <p className="text-[13.5px] leading-relaxed text-charcoal">{profile.comment}</p>
        </section>
      )}

      <p className="text-center text-[12px] text-sub">
        この結果は今後、美容師とのマッチングに活用される予定です。
      </p>
    </div>
  );
}
