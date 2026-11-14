"use client";

import { useEffect, useRef, useState } from "react";
import type { StylistCoreType } from "@/types/database";

/**
 * 美容師タイプのキャラクター表示（背景つき・控えめなアニメーション）。
 *
 * - 背景画像／光の画像／後光／きらめき／キャラクターは別レイヤーで、それぞれ独立してゆっくり動く。
 * - 動くのは transform（上下・わずかな平行移動）と opacity のみ。レイアウトは揺れない。
 * - 上下12px・1往復5秒（globals.css の .cs-* で定義）。
 * - 端末の「動きを減らす」設定では静止（globals.css 側の共通ルール＋.cs-* 側でも静止）。
 * - 画面外・タブが裏のときはアニメーションを止める（IntersectionObserver / visibilitychange）。
 * - 対象外のタイプ（STAGE_TYPES に無いもの）は、従来どおりの表示（legacySrc）のまま。
 */

/** 背景つき表示の対象タイプ（素材が整ったものだけ）。 */
const STAGE_TYPES: ReadonlySet<StylistCoreType> = new Set<StylistCoreType>([
  "aisare_ace",
  "niaiwase_master",
  "trend_maker",
  "iyashi_charisma",
  "mirai_no_ace",
  "repeat_king",
  "brand_builder",
  "shimei_jishaku",
]);

const SPARKLES: ReadonlyArray<readonly [number, number, number, string]> = [
  [12, 18, 16, "0s"],
  [72, 14, 22, "1.1s"],
  [86, 36, 14, "2.3s"],
  [8, 52, 20, ".6s"],
  [90, 62, 18, "1.7s"],
  [20, 82, 14, "2.9s"],
  [66, 78, 16, ".2s"],
  [42, 6, 14, "1.4s"],
  [28, 36, 12, "3.3s"],
];

type Props = {
  coreTypeCode: StylistCoreType;
  /** 従来表示のキャラクター画像パス（対象外タイプで使う） */
  legacySrc: string;
  alt: string;
  /** 背景つき表示の幅（例: "w-44 sm:w-52"）。高さは 4:5 で決まる。 */
  stageClassName: string;
  /** 従来表示の枠（例: "h-48 w-48 sm:h-56 sm:w-56"） */
  legacyClassName: string;
};

export function CharacterStage({ coreTypeCode, legacySrc, alt, stageClassName, legacyClassName }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const useStage = STAGE_TYPES.has(coreTypeCode);

  useEffect(() => {
    if (!useStage) return;
    const el = ref.current;
    if (!el) return;
    let inView = true;
    const update = () => setPaused(!inView || document.hidden);
    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            (entries) => {
              inView = entries[0]?.isIntersecting ?? true;
              update();
            },
            { threshold: 0 },
          )
        : null;
    io?.observe(el);
    document.addEventListener("visibilitychange", update);
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [useStage]);

  if (!useStage) {
    return (
      <div className={`relative ${legacyClassName}`}>
        <div className="absolute inset-0 rounded-full bg-gradient-to-b from-[var(--gold)]/15 to-transparent blur-xl" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={legacySrc} alt={alt} className="relative h-full w-full object-contain drop-shadow-sm" />
      </div>
    );
  }

  const base = `/characters/stage/${coreTypeCode}`;
  return (
    <div ref={ref} className={`cs-stage ${paused ? "cs-paused" : ""} ${stageClassName}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="cs-bg" src={`${base}-bg.webp`} alt="" aria-hidden="true" width={608} height={760} />
      <div className="cs-glow" aria-hidden="true" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="cs-lights" src={`${base}-lights.webp`} alt="" aria-hidden="true" width={608} height={760} loading="lazy" />
      <div className="cs-spark" aria-hidden="true">
        {SPARKLES.map(([x, y, s, d], i) => (
          <svg key={i} viewBox="0 0 24 24" style={{ left: `${x}%`, top: `${y}%`, width: s, height: s, animationDelay: d }}>
            <path
              d="M12 0c.9 6.6 4.9 10.6 12 12-7.1 1.4-11.1 5.4-12 12-.9-6.6-4.9-10.6-12-12C7.1 10.6 11.1 6.6 12 0z"
              fill="#fff"
              stroke="#ffd7a1"
              strokeWidth=".8"
            />
          </svg>
        ))}
      </div>
      <div className="cs-char">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${base}-char.webp`} alt={alt} width={560} height={840} />
      </div>
    </div>
  );
}
