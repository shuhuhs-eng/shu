import Link from "next/link";
import {
  resolveCultureAnalysis,
  stepToRadiusRatio,
  type AnalysisResult,
  type AxisResult,
  type SupplementRow,
} from "@/lib/salon-culture/analysis/v1";

type SectionProps = {
  /** salon_culture_profiles / salon_store_culture_profiles の status（行が無ければ null）。 */
  status: "completed" | "draft" | null;
  /** その行の answers（既存12問の回答）。 */
  baseAnswers: unknown;
  /** その対象（本人／店舗）の追加回答の行（無ければ null）。 */
  supplement: SupplementRow;
  /** 取得そのものに失敗したか（「未回答」とは別に表示する）。 */
  loadFailed?: boolean;
  /** 既存12問の回答画面（例: /salon/culture, /salon/stores/{id}/culture）。 */
  answerPath: string;
  /** 追加5問の回答画面。 */
  analysisPath: string;
  /** 回答対象の名前（サロン名・店舗名）。 */
  targetName: string | null;
  targetKind: "personal" | "store";
  /** 追加回答を保存できる権限があるか（閲覧のみなら false）。 */
  canEdit?: boolean;
  heading?: string;
};

const W = 420;
const H = 300;
const CX = 210;
const CY = 150;
const R = 80;

const CHART_LABELS = ["①育成の進め方", "②新しいこと", "③個人の発信", "④仕事上の連携", "⑤進め方の裁量"];

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

/** 5軸すべてが判定できたときだけ描く。欠けた軸を1や3で埋めて描くことはしない。 */
function RadarChart({ axes }: { axes: AxisResult[] }) {
  const label = axes.map((a) => `${a.name} 5段階中${a.step}`).join("、");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`サロンらしさの5軸バランス。${label}。中心に近いほど1側、外側ほど5側の方針です。`}
      className="mx-auto block h-auto w-full max-w-[420px]"
    >
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
        points={polygon((i) => stepToRadiusRatio(axes[i].step ?? 1))}
        fill="var(--gold)"
        fillOpacity={0.22}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        className="text-ink"
      />
      {axes.map((a, i) => {
        const dot = point(i, stepToRadiusRatio(a.step ?? 1));
        const lab = point(i, 1, 16);
        const anchor = Math.abs(lab.x - CX) < 8 ? "middle" : lab.x > CX ? "start" : "end";
        const dy = lab.y < CY - 40 ? -4 : lab.y > CY + 40 ? 12 : 4;
        return (
          <g key={a.id}>
            <circle cx={dot.x} cy={dot.y} r={4} className="fill-ink" />
            <text x={lab.x} y={lab.y + dy} textAnchor={anchor} className="fill-ink" fontSize={13} fontWeight={600}>
              {CHART_LABELS[i]}
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

const STATUS_TEXT: Record<Exclude<AxisResult["status"], "determined">, string> = {
  undetermined_na: "判定できません（「当てはまらない」の回答があるため）。",
  pending: "追加の質問に回答すると表示されます。",
  stale: "既存の回答が更新されたため、追加の質問の確認が必要です。",
};

/** 軸ごとの表示。判定できない軸でも、読み取れる回答の根拠文は隠さない。 */
function AxisList({ axes }: { axes: AxisResult[] }) {
  return (
    <ul className="mt-5 space-y-4 text-left">
      {axes.map((a) => {
        const sentences = a.scenes.map((s) => s.sentence).filter((s): s is string => s != null);
        return (
          <li key={a.id} className="border-t border-line pt-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[14px] font-semibold text-ink">
                {a.number} {a.name}
              </span>
              {a.status === "determined" && a.step != null && (
                <span className="shrink-0 text-[13px] text-charcoal">
                  <StepDots step={a.step} /> <span className="font-semibold">{a.step}</span>
                  <span className="text-sub"> / 5段階</span>
                </span>
              )}
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-sub">{a.note}</p>
            {a.status === "determined" ? (
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink">{a.description}</p>
            ) : (
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-charcoal">{STATUS_TEXT[a.status]}</p>
            )}
            {a.differ && (
              <p className="mt-1.5 text-[12.5px] font-semibold leading-relaxed text-ink">
                場面によって違いがあります。
                <span className="font-normal text-charcoal">
                  （回答：{a.scenes.map((s) => (s.answer === "na" || s.answer == null ? "−" : s.answer)).join(" と ")}）
                </span>
              </p>
            )}
            {sentences.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {sentences.map((t) => (
                  <li key={t} className="text-[12px] leading-relaxed text-sub">
                    ・{t}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function HowToRead() {
  return (
    <details className="mt-5 border-t border-line pt-3 text-left">
      <summary className="cursor-pointer text-[12.5px] font-semibold text-charcoal">この5段階の見方</summary>
      <div className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-sub">
        <p>各軸は、別々の場面を聞いた2つの回答から作っています。回答全体では、どちらの方針に寄っているかを1〜5で表しています。</p>
        <p>
          2つの回答を同じ重さで平均し、平均が1.8未満なら1、2.6未満なら2、3.4未満なら3、4.2未満なら4、4.2以上なら5としています。5段階だからといって、2つとも5という意味ではありません。
        </p>
        <p>2つの回答が2段階以上離れている軸は、「場面によって違いがあります」と表示しています。回答の良し悪しを示すものではありません。</p>
        <p>「当てはまらない」の回答や未回答は、数値で埋めず、判定できないものとして表示しています。</p>
        <p>
          1と5は、優劣ではなく方針の違いです。他のサロンとの比較や補正はしていません。この見方はBeauty Reachの独自の設計で、統計的に検証したものではありません。
        </p>
      </div>
    </details>
  );
}

function Cta({ href, children, primary = true }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`mt-4 flex w-full items-center justify-center rounded-full px-6 py-3 text-[14px] font-semibold ${
        primary ? "bg-ink text-surface" : "border border-line bg-surface text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

function body(result: AnalysisResult, p: SectionProps): React.ReactNode {
  const canEdit = p.canEdit !== false;
  const analysisCta = canEdit ? (
    <Cta href={p.analysisPath}>追加の5問に回答する</Cta>
  ) : (
    <p className="mt-3 text-[12px] leading-relaxed text-sub">この店舗では閲覧のみの権限のため、追加の回答はできません。</p>
  );

  switch (result.state) {
    case "base_none":
      return (
        <>
          <p className="text-[13.5px] leading-relaxed text-charcoal">まだ回答していません。回答すると、サロンの方針・環境が5軸で表示されます。</p>
          <Cta href={p.answerPath}>サロンらしさを回答する</Cta>
        </>
      );
    case "base_draft":
      return (
        <>
          <p className="text-[13.5px] leading-relaxed text-charcoal">回答の途中です。最後まで回答すると、5軸が表示されます。</p>
          <Cta href={p.answerPath}>回答を続ける</Cta>
        </>
      );
    case "base_unusable":
      return (
        <>
          <p className="text-[13.5px] leading-relaxed text-charcoal">
            5軸の表示に使う既存の回答が揃っていません。サロンらしさの回答を更新すると表示できます。
          </p>
          <Cta href={`${p.answerPath}?edit=1`}>サロンらしさを更新する</Cta>
        </>
      );
    case "need_supplement":
      return (
        <>
          <p className="text-[13.5px] leading-relaxed text-charcoal">
            5軸を表示するには、追加の5問（1分ほど）への回答が必要です。回答しなくても、他の機能は今までどおり使えます。
          </p>
          {analysisCta}
          <p className="mt-5 text-left text-[12.5px] font-semibold text-charcoal">今の回答から読み取れること</p>
          <AxisList axes={result.axes} />
          <HowToRead />
        </>
      );
    case "stale":
      return (
        <>
          <p className="text-[13.5px] leading-relaxed text-charcoal">
            サロンらしさの既存の回答が、追加の回答のあとに更新されています。前の回答と組み合わせず、追加の5問を確認し直してください。
          </p>
          {analysisCta}
          <AxisList axes={result.axes} />
          <HowToRead />
        </>
      );
    case "partial":
      return (
        <>
          <p className="text-[13.5px] leading-relaxed text-charcoal">
            「当てはまらない」の回答がある軸は判定できないため、5軸の図は表示していません。判定できた軸と回答の根拠は下に表示しています。
          </p>
          <AxisList axes={result.axes} />
          {canEdit && <Cta href={p.analysisPath} primary={false}>追加の5問を更新する</Cta>}
          <HowToRead />
        </>
      );
    case "ready":
      return (
        <>
          <RadarChart axes={result.axes} />
          <p className="mt-2 text-center text-[12.5px] leading-relaxed text-charcoal">
            回答から見えるサロンの方針・環境です。優劣を示すものではありません。
          </p>
          <AxisList axes={result.axes} />
          <HowToRead />
          {canEdit && <Cta href={p.analysisPath} primary={false}>追加の5問を更新する</Cta>}
        </>
      );
  }
}

/**
 * 「サロンらしさ」5軸表示（カード1枚分）。表示専用。DB・RPC・診断・マッチングには触れない。
 * 本人と店舗は別々に表示する（対象名を表示。他の店舗・他のユーザーの回答は使わない）。
 */
export function CultureRadarSection(props: SectionProps) {
  const { loadFailed = false, heading = "サロンらしさ" } = props;
  const result = resolveCultureAnalysis({ baseStatus: props.status, baseAnswers: props.baseAnswers, supplement: props.supplement });

  return (
    <section className="rounded-2xl border border-line bg-surface p-6 text-center">
      <h2 className="font-serif text-lg font-bold text-ink">{heading}</h2>
      {props.targetName && (
        <p className="mt-1 text-[12px] text-sub">
          対象：{props.targetName}（{props.targetKind === "store" ? "店舗" : "個人"}の回答）
        </p>
      )}
      <div className="mt-3">
        {loadFailed ? (
          <p className="text-[13.5px] leading-relaxed text-charcoal">
            サロンらしさを読み込めませんでした。画面を更新してもう一度お試しください。
            <br />
            <span className="text-[12px] text-sub">回答していない、という意味ではありません。</span>
          </p>
        ) : (
          body(result, props)
        )}
      </div>
    </section>
  );
}
