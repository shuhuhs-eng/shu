import type { SalonCultureAxes } from "@/types/database";
import { deriveTypeBasis } from "@/lib/salon-culture/analysis/type-evidence";

const ROLE_LABEL = { main: "メインタイプ", sub: "サブタイプ", tied: "同程度に表れている特徴" } as const;

/**
 * サロンタイプの根拠（実回答に基づく文）。表示専用。
 * タイプの判定・5軸の計算には影響しない。水準の断定（強い/弱い）はしない。
 */
export function TypeBasis({ axes }: { axes: SalonCultureAxes | null | undefined }) {
  const basis = deriveTypeBasis(axes ?? {});
  if (!basis) return null;
  return (
    <div className="mt-5 border-t border-line pt-4 text-left">
      <p className="eyebrow mb-2 text-center">このタイプの根拠（回答より）</p>
      {basis.levelNote && <p className="mb-3 text-center text-[13px] font-semibold text-ink">{basis.levelNote}</p>}
      {basis.items.map((item) => (
        <div key={item.code} className="mb-3">
          <p className="text-[13px] font-semibold text-ink">
            {item.name}
            <span className="ml-2 text-[11.5px] font-normal text-sub">（{ROLE_LABEL[item.role]}）</span>
          </p>
          <ul className="mt-1 space-y-0.5">
            {item.sentences.map((t) => (
              <li key={t} className="text-[12px] leading-relaxed text-charcoal">
                ・{t}
              </li>
            ))}
          </ul>
          {item.note && <p className="mt-1 text-[11.5px] leading-relaxed text-sub">※{item.note}</p>}
        </div>
      ))}
      <p className="text-center text-[11.5px] leading-relaxed text-sub">{basis.caption}</p>
    </div>
  );
}
