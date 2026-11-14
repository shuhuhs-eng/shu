import type { AiOutputType } from "@/types/database";
import { splitLead, splitStep } from "@/lib/diagnosis/ai-text";

type Props = {
  aiByType: Partial<Record<AiOutputType, unknown>>;
  isGenerating: boolean;
};

const STEP_STYLES = [
  { tint: "#2E8B7F", icon: "🧭", label: "まず" },
  { tint: "#B8860B", icon: "🛠️", label: "次に" },
  { tint: "#6E4AA6", icon: "🚀", label: "さらに" },
  { tint: "#B23A6B", icon: "🌟", label: "そして" },
] as const;

function asText(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}
function asList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter((x) => x.trim().length > 0) : typeof v === "string" && v.trim() ? [v] : [];
}

/**
 * AI解説の表示（見せ方のみ。AIの生成ロジック・文章は変更しない）。
 *   ・AIから一言: 短く（先頭の1〜2文）。残りは「続きを読む」に格納
 *   ・次の一手: 色・アイコン・番号つきの手順カード（色だけでなく「STEP n」と文字で順序を示す）
 *   ・将来の可能性: 短いカード
 *   ・詳細分析: 必要な人だけ開く（初期は閉じている）
 */
export function AiNarrativeBlocks({ aiByType, isGenerating }: Props) {
  if (isGenerating) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-6 text-center">
        <p className="text-[13.5px] text-sub">AI解説を生成しています。しばらくしてから再度ご確認ください。</p>
      </section>
    );
  }

  const essence = asText(aiByType.essence);
  const steps = asList(aiByType.advice);
  const growth = asText(aiByType.growth);
  const explanation = asText(aiByType.explanation);
  if (!essence && steps.length === 0 && !growth && !explanation) return null;

  const lead = essence ? splitLead(essence) : null;

  return (
    <div className="space-y-4">
      {lead && (
        <section className="rounded-2xl border border-line bg-surface p-6">
          <p className="mb-2 flex items-center gap-2 eyebrow"><span aria-hidden="true">✨</span>AIから一言</p>
          <p className="text-[15px] font-semibold leading-relaxed text-ink">{lead.lead}</p>
          {lead.rest && (
            <details className="mt-2">
              <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[12.5px] text-sub underline">続きを読む</summary>
              <p className="text-[13.5px] leading-relaxed text-charcoal">{lead.rest}</p>
            </details>
          )}
        </section>
      )}

      {steps.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-6">
          <p className="mb-1 flex items-center gap-2 eyebrow"><span aria-hidden="true">🚶</span>次の一手</p>
          <p className="mb-4 text-[12px] text-sub">上から順に、できそうなものから始めてみてください。</p>
          <ol className="space-y-0">
            {steps.map((item, i) => {
              const st = STEP_STYLES[i % STEP_STYLES.length];
              const { title, detail } = splitStep(item);
              return (
                <li key={i} className="relative pl-12">
                  {i < steps.length - 1 && <span aria-hidden="true" className="absolute left-[17px] top-9 h-[calc(100%-12px)] w-0.5" style={{ background: `${st.tint}55` }} />}
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-0 flex h-9 w-9 items-center justify-center rounded-full text-[16px]"
                    style={{ background: `${st.tint}1F`, border: `1.5px solid ${st.tint}` }}
                  >
                    {st.icon}
                  </span>
                  <div className="mb-3 rounded-xl border px-4 py-3" style={{ borderColor: `${st.tint}55`, background: `${st.tint}0D` }}>
                    <p className="text-[11px] font-bold tracking-wide" style={{ color: st.tint }}>
                      STEP {i + 1}（{st.label}）
                    </p>
                    <p className="mt-0.5 text-[14px] font-semibold leading-relaxed text-ink">{title}</p>
                    {detail && <p className="mt-1 text-[13px] leading-relaxed text-charcoal">{detail}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {growth && (
        <section className="rounded-2xl border border-line bg-surface p-6">
          <p className="mb-2 flex items-center gap-2 eyebrow"><span aria-hidden="true">🌱</span>将来の可能性</p>
          <p className="text-[13.5px] leading-relaxed text-charcoal">{growth}</p>
        </section>
      )}

      {explanation && (
        <details className="rounded-2xl border border-line bg-surface px-6 py-1">
          <summary className="flex min-h-[48px] cursor-pointer items-center gap-2 text-[13px] font-semibold text-ink">
            <span aria-hidden="true">🔍</span>詳細分析を開く
          </summary>
          <p className="pb-4 text-[13.5px] leading-relaxed text-charcoal">{explanation}</p>
        </details>
      )}
    </div>
  );
}
