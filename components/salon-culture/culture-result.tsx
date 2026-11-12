import Link from "next/link";
import { SALON_VALUE_PRIORITY_OPTIONS } from "@/lib/validation/profile-options";
import { deriveIdealFitDescriptions } from "@/lib/salon-culture/culture-display";
import {
  deriveSalonTypes,
  deriveTopCharacteristics,
  SALON_TYPE_CONTENT,
} from "@/lib/salon-culture/salon-culture-types";
import { CultureRadarSection } from "@/components/salon-culture/culture-radar";
import { TypeBasis } from "@/components/salon-culture/type-basis";
import type { SupplementRow } from "@/lib/salon-culture/analysis/v1";
import type { Database } from "@/types/database";

type Props = {
  profile: Database["public"]["Tables"]["salon_culture_profiles"]["Row"];
  /** 本人の追加回答（無ければ null）。店舗の回答は使わない。 */
  supplement: SupplementRow;
  /** 回答対象のサロン名。 */
  targetName: string | null;
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
 * value_priorities・comment・「美容師との相性」案内（候補者ごとの相性は既存の「美容師を探す」で確認する）の各
 * セクションは既存のまま維持している（削除していない）。
 */
export function CultureResult({ profile, supplement, targetName }: Props) {
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

          <TypeBasis axes={axes} />

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

      {/* 5軸バランス（表示専用）。この画面の対象（本人／店舗）と同じ行の culture_axes だけを使う。 */}
      <CultureRadarSection
        status={profile.status}
        baseAnswers={profile.answers}
        supplement={supplement}
        answerPath="/salon/culture"
        analysisPath="/salon/culture/analysis"
        targetName={targetName}
        targetKind="personal"
      />

      {/* 美容師との相性案内。相性は候補の美容師ごとに計算され、美容師の一覧（既存の「美容師を探す」）で確認できる。
          この画面は自分のサロンらしさの結果なので、計算はここでは行わない。 */}
      <section className="rounded-2xl border border-line bg-surface p-6 text-center">
        <h2 className="font-serif text-lg font-bold text-ink">美容師との相性を確認できます</h2>
        <p className="mt-3 text-[13px] leading-relaxed text-charcoal">
          美容師を探す画面で、候補の美容師ごとに、
          <br />
          このサロンらしさとの相性（総合マッチ度と各軸）を確認できます。
          <br />
          相性は、美容師が「働きたいサロン環境」を回答している場合に表示されます。
        </p>
        <Link
          href="/salon/stylists"
          className="mt-4 inline-flex items-center justify-center rounded-full bg-ink px-6 py-3 text-[14px] font-semibold text-surface"
        >
          美容師を探す
        </Link>
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
        この結果は、美容師との相性の計算に使われます。
      </p>
    </div>
  );
}
