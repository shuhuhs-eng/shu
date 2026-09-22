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
  profile: Database["public"]["Tables"]["salon_culture_profiles"]["Row"];
};

/**
 * 「サロンらしさ」結果画面（新12軸・サロン8タイプ仕様）。
 *
 * ★診断ロジック・DB・RPCには一切変更を加えていない。表示専用の派生ロジックは
 * lib/salon-culture/salon-culture-types.ts に分離し、既存のculture_axes（RPCが
 * 既に算出・保存済みの値）を読むだけで、書き込みは一切行わない。将来の
 * マッチングロジックは8タイプを直接使わず、元の12軸を直接使う想定であり、
 * この分離構造はそれを壊さない。
 *
 * ★旧データ互換: 新12軸が揃っていない（旧3軸・旧5軸のみの）salon_culture_profiles
 * に対しては、deriveSalonTypes()/deriveTopCharacteristics()がnullを返すため、
 * 8タイプを算出せず（旧値を0として扱わない）、更新案内を表示する。
 *
 * value_priorities・comment・「あなたらしさ×サロンらしさ」Coming Soonの各
 * セクションは既存のまま維持している（削除していない）。
 */
export function CultureResult({ profile }: Props) {
  const axes = profile.culture_axes ?? {};
  const classification = deriveSalonTypes(axes);
  const characteristics = deriveTopCharacteristics(axes);
  const idealFit = deriveIdealFitDescriptions(axes);

  return (
    <div className="space-y-6">
      {classification ? (
        <section className="rounded-2xl border border-line bg-surface p-6 text-center">
          <p className="eyebrow mb-2">あなたのサロンタイプは</p>
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
              href="/salon/culture?edit=1"
              className="flex w-full max-w-[280px] items-center justify-center rounded-full bg-ink px-6 py-3 text-[14px] font-semibold text-surface"
            >
              サロンらしさを更新する
            </Link>
          </div>
        </section>
      )}

      {/* 「あなたらしさ×サロンらしさ」相性表示の将来枠。実際の相性計算・
          マッチングの実装を待つプレースホルダー。旧8タイプ前提の文言だった
          ため、新しい表現へ更新した。 */}
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
