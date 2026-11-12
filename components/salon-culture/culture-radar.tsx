import Link from "next/link";
import type { SalonCultureAxes } from "@/types/database";
import { deriveCultureRadar, stepToRadiusRatio, type CultureRadar as CultureRadarData } from "@/lib/salon-culture/culture-radar";

type Status = "completed" | "draft" | null;

type SectionProps = {
  /** salon_culture_profiles / salon_store_culture_profiles の status（行が無ければ null）。 */
  status: Status;
  /** その行の culture_axes。 */
  axes: SalonCultureAxes | null | undefined;
  /** 取得そのものに失敗したか（「未回答」とは別に表示する）。 */
  loadFailed?: boolean;
  /** 回答画面のパス（例: /salon/culture, /salon/stores/{id}/culture）。表示している対象と同じ画面を渡す。 */
  answerPath: string;
  /** 見出し（デフォルト: サロンらしさ）。 */
  heading?: string;
};

const W = 360;
const H = 300;
const CX = 180;
const CY = 150;
const R = 86;

function point(i: number, ratio: number, extra = 0) {
  const angle = (-90 + i * 72) * (Math.PI / 180);
  const r = R * ratio + extra;
  return { x: CX + Math.cos(angle) * r, y: CY + Math.sin(angle) * r };
}

function polygon(ratio: (i: number) => number) {
  return [0, 1, 2, 3, 4]
    .map((i) => {
      const p = point(i, ratio(i));
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(" ");
}

/** 5軸の五角形チャート本体（5軸すべてが取得できているときだけ描く）。 */
function RadarChart({ radar }: { radar: CultureRadarData }) {
  const label = radar.axes.map((a) => `${a.name} 5段階中${a.step}`).join("、");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`サロンらしさの5軸バランス。${label}。中心に近いほど1側、外側ほど5側の方針です。`}
      className="mx-auto block h-auto w-full max-w-[360px]"
    >
      {/* 目盛り（1・3・5段階）。段階の位置が分かるよう線の種類も変える（色だけに頼らない）。 */}
      {[1, 3, 5].map((s) => (
        <polygon
          key={s}
          points={polygon(() => stepToRadiusRatio(s))}
          fill="none"
          stroke="currentColor"
          strokeOpacity={s === 5 ? 0.45 : 0.22}
          strokeDasharray={s === 3 ? "3 3" : undefined}
          className="text-sub"
        />
      ))}
      {[0, 1, 2, 3, 4].map((i) => {
        const p = point(i, 1);
        return <line key={i} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="currentColor" strokeOpacity={0.2} className="text-sub" />;
      })}

      <polygon
        points={polygon((i) => stepToRadiusRatio(radar.axes[i].step ?? 1))}
        fill="var(--gold)"
        fillOpacity={0.22}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        className="text-ink"
      />

      {radar.axes.map((a, i) => {
        const dot = point(i, stepToRadiusRatio(a.step ?? 1));
        const lab = point(i, 1, 16);
        const anchor = Math.abs(lab.x - CX) < 8 ? "middle" : lab.x > CX ? "start" : "end";
        const dy = lab.y < CY - 40 ? -4 : lab.y > CY + 40 ? 12 : 4;
        return (
          <g key={a.key}>
            <circle cx={dot.x} cy={dot.y} r={4} className="fill-ink" />
            <text x={lab.x} y={lab.y + dy} textAnchor={anchor} className="fill-ink" fontSize={13} fontWeight={600}>
              {a.name}
              <tspan x={lab.x} dy={15} fontSize={12} fontWeight={500} className="fill-charcoal">
                {a.step}段階
              </tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function StepDots({ step }: { step: number }) {
  return (
    <span aria-hidden="true" className="tracking-[0.2em] text-ink">
      {[1, 2, 3, 4, 5].map((n) => (n === step ? "●" : "○")).join("")}
    </span>
  );
}

/**
 * 「サロンらしさ」5軸バランス表示（カード1枚分）。
 * 表示専用。DB・RPC・診断・マッチングには触れない（lib/salon-culture/culture-radar.ts 参照）。
 * 未回答・回答途中・取得失敗・軸の欠落は、1や3で埋めずに状態として明示する。
 */
export function CultureRadarSection({ status, axes, loadFailed = false, answerPath, heading = "サロンらしさ" }: SectionProps) {
  const radar = deriveCultureRadar(axes);

  let body: React.ReactNode;
  if (loadFailed) {
    body = (
      <p className="text-[13.5px] leading-relaxed text-charcoal">
        サロンらしさを読み込めませんでした。画面を更新してもう一度お試しください。
        <br />
        <span className="text-[12px] text-sub">回答していない、という意味ではありません。</span>
      </p>
    );
  } else if (status == null) {
    body = (
      <>
        <p className="text-[13.5px] leading-relaxed text-charcoal">まだ回答していません。回答すると、サロンの方針・環境が5軸で表示されます。</p>
        <Link
          href={answerPath}
          className="mt-4 flex w-full items-center justify-center rounded-full bg-ink px-6 py-3 text-[14px] font-semibold text-surface"
        >
          サロンらしさを回答する
        </Link>
      </>
    );
  } else if (status === "draft") {
    body = (
      <>
        <p className="text-[13.5px] leading-relaxed text-charcoal">回答の途中です。最後まで回答すると、5軸が表示されます。</p>
        <Link
          href={answerPath}
          className="mt-4 flex w-full items-center justify-center rounded-full bg-ink px-6 py-3 text-[14px] font-semibold text-surface"
        >
          回答を続ける
        </Link>
      </>
    );
  } else if (!radar.complete) {
    body = (
      <>
        <p className="text-[13.5px] leading-relaxed text-charcoal">
          5軸のうち、取得できていない項目があります（{radar.missing.join("・")}）。
          <br />
          回答を更新すると表示されます。
        </p>
        <Link
          href={`${answerPath}?edit=1`}
          className="mt-4 flex w-full items-center justify-center rounded-full bg-ink px-6 py-3 text-[14px] font-semibold text-surface"
        >
          サロンらしさを更新する
        </Link>
      </>
    );
  } else {
    body = (
      <>
        <RadarChart radar={radar} />
        <p className="mt-2 text-center text-[12.5px] leading-relaxed text-charcoal">
          回答から見えるサロンの方針・環境です。優劣を示すものではありません。
        </p>

        <ul className="mt-5 space-y-4 text-left">
          {radar.axes.map((a) => (
            <li key={a.key} className="border-t border-line pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-semibold text-ink">{a.name}</span>
                <span className="shrink-0 text-[13px] text-charcoal">
                  <StepDots step={a.step ?? 0} /> <span className="font-semibold">{a.step}</span>
                  <span className="text-sub"> / 5段階</span>
                </span>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink">{a.summary}</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-sub">
                <span className="font-semibold">1</span>：{a.low}
              </p>
              <p className="text-[12px] leading-relaxed text-sub">
                <span className="font-semibold">5</span>：{a.high}
              </p>
            </li>
          ))}
        </ul>

        <details className="mt-5 border-t border-line pt-3 text-left">
          <summary className="cursor-pointer text-[12.5px] font-semibold text-charcoal">この5段階の見方</summary>
          <div className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-sub">
            <p>
              各軸は、サロンらしさ診断の1つの質問（5段階の選択）への回答そのものです。左端の方針を1、右端の方針を5として表示しています。
            </p>
            <p>回答を足したり平均したりはしていません。他のサロンとの比較や、数値の底上げ・補正もしていません。</p>
            <p>1と5はどちらが良い・悪いではなく、方針の違いです。チャートが大きいほど良い、という意味ではありません。</p>
            <p>ここに出している5軸は、サロンらしさ診断の12項目のうちの代表です。残りの項目は「このサロンの特徴」に反映されます。</p>
          </div>
        </details>

        <Link
          href={`${answerPath}?edit=1`}
          className="mt-5 flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-3 text-[14px] font-semibold text-ink"
        >
          サロンらしさを更新する
        </Link>
      </>
    );
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-6 text-center">
      <h2 className="font-serif text-lg font-bold text-ink">{heading}</h2>
      <div className="mt-3">{body}</div>
    </section>
  );
}
