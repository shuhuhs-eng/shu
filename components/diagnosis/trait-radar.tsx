import { TRAITS, type TraitScores, type TraitKey } from "@/lib/diagnosis";
import { TRAIT_INFO, TRAIT_ORDER, TRAIT_SCALE_NOTE } from "@/lib/diagnosis/trait-descriptions";

const CX = 160;
const CY = 150;
const R = 96; // 100点の半径
const LABEL_R = 122;
const RINGS = [25, 50, 75, 100];

/** 0〜100へ丸める（想定外の値で図が壊れないようにする）。 */
export function clampScore(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
}

/** i番目の頂点（上から時計回り、6頂点）。ratio は 0〜1。 */
export function hexPoint(i: number, ratio: number, radius = R): [number, number] {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 6;
  return [CX + Math.cos(angle) * radius * ratio, CY + Math.sin(angle) * radius * ratio];
}

export function hexPolygon(ratios: number[]): string {
  return ratios.map((r, i) => hexPoint(i, r).map((n) => n.toFixed(1)).join(",")).join(" ");
}

type Props = {
  scores: TraitScores;
  /** グラフの色（タイプの代表色など）。色だけで意味を伝えないよう、数値と項目名を必ず併記する。 */
  accent?: string;
};

/**
 * 6才能の六角形レーダーチャート。6項目（技術・感性・接客・発信・挑戦・育成）をそのまま使い、
 * 項目の削除・合算はしない。各項目は0〜100（scoreTraits の既存の値）で、共通の尺度のため比較できる。
 * グラフ本体はスクリーンリーダー向けに全項目の値を読み上げ、下の一覧にも説明と数値を並べる。
 */
export function TraitRadar({ scores, accent = "#8B5E3C" }: Props) {
  const values = TRAIT_ORDER.map((k) => clampScore(scores[k]));
  const label = TRAIT_ORDER.map((k, i) => `${TRAIT_INFO[k].name} ${Math.round(values[i])}点`).join("、");
  const color = (k: TraitKey) => TRAITS.find((t) => t.key === k)?.color ?? accent;

  return (
    <div>
      <svg viewBox="0 0 320 300" role="img" aria-label={`6つの才能のバランス（各0〜100）: ${label}`} className="mx-auto block w-full max-w-[340px]">
        {RINGS.map((p) => (
          <polygon key={p} points={hexPolygon(Array(6).fill(p / 100))} fill="none" stroke="var(--line, #E4DED5)" strokeWidth={p === 100 ? 1.4 : 1} />
        ))}
        {TRAIT_ORDER.map((_, i) => {
          const [x, y] = hexPoint(i, 1);
          return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="var(--line, #E4DED5)" strokeWidth={1} />;
        })}
        {/* 目盛り（50と100）。色に頼らず数値で尺度を示す。 */}
        <text x={CX + 4} y={CY - R * 0.5 + 3} fontSize="8.5" fill="#8A8178">50</text>
        <text x={CX + 4} y={CY - R + 3} fontSize="8.5" fill="#8A8178">100</text>
        <polygon points={hexPolygon(values.map((v) => v / 100))} fill={accent} fillOpacity={0.2} stroke={accent} strokeWidth={2.2} strokeLinejoin="round" />
        {TRAIT_ORDER.map((k, i) => {
          const [x, y] = hexPoint(i, values[i] / 100);
          return <circle key={k} cx={x} cy={y} r={4.2} fill={color(k)} stroke="#fff" strokeWidth={1.5} />;
        })}
        {TRAIT_ORDER.map((k, i) => {
          const [x, y] = hexPoint(i, 1, LABEL_R);
          const anchor = Math.abs(x - CX) < 4 ? "middle" : x > CX ? "start" : "end";
          const dy = y < CY - 4 ? -2 : y > CY + 4 ? 10 : 4;
          return (
            <g key={k}>
              <text x={x} y={y + dy} textAnchor={anchor} fontSize="13" fontWeight="700" fill="#2A2622">
                {TRAIT_INFO[k].name}
              </text>
              <text x={x} y={y + dy + 14} textAnchor={anchor} fontSize="12" fill="#6B635B">
                {Math.round(values[i])}
              </text>
            </g>
          );
        })}
      </svg>

      <p className="mt-1 text-center text-[11.5px] leading-relaxed text-sub">{TRAIT_SCALE_NOTE}</p>

      <ul className="mt-4 space-y-2.5">
        {TRAIT_ORDER.map((k, i) => (
          <li key={k} className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color(k) }} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[13.5px] font-semibold text-ink">{TRAIT_INFO[k].name}</span>
                <span className="font-data text-[13px] text-charcoal">
                  {Math.round(values[i])}
                  <span className="text-[11px] text-sub"> / 100</span>
                </span>
              </span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-sub">{TRAIT_INFO[k].description}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
