import type { ExperienceProfile } from "@/lib/diagnosis/experience-profile";

type Props = {
  profile: ExperienceProfile;
  /** 既存の想定年収帯（算出済みの値）。主役にはせず、参考として小さく折りたたむ。点数・順位には置き換えない。 */
  salaryBand?: string | null;
};

/**
 * 経験・実績の特徴と、これから伸ばせる点（旧「市場価値○点」の主役表示をやめた）。
 * 表示するのは、本人が選んだ回答と6才能の傾向だけ。点数・「上位○%」・給与額への置き換えはしない。
 * 色だけで意味を伝えないよう、見出し文字とアイコンの両方で区別している。
 */
export function MarketValueCard({ profile, salaryBand }: Props) {
  const { answers, strengths, growth } = profile;
  const facts = [
    answers.experience && { label: "経験", value: answers.experience },
    answers.role && { label: "いまの役割", value: answers.role },
    answers.specialties.length > 0 && { label: "得意分野", value: answers.specialties.join("・") },
    answers.workStyles.length > 0 && { label: "大切にしたい働き方", value: answers.workStyles.join("・") },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <p className="eyebrow mb-1">あなたの経験・実績の特徴</p>
      <p className="text-[12px] leading-relaxed text-sub">診断で選んだ回答と、才能のバランスから読み取った内容です。点数や順位ではありません。</p>

      {facts.length > 0 && (
        <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {facts.map((f) => (
            <div key={f.label} className="rounded-xl bg-surface2 px-4 py-3">
              <dt className="text-[11px] font-semibold text-sub">{f.label}</dt>
              <dd className="mt-0.5 text-[13.5px] font-semibold text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-5 rounded-xl border border-[#2E8B7F]/30 bg-[#2E8B7F]/[0.07] px-4 py-3.5">
        <p className="flex items-center gap-1.5 text-[13px] font-bold text-[#1F6B61]">
          <span aria-hidden="true">💪</span>強みとして表れている点
        </p>
        <ul className="mt-2 space-y-1.5">
          {strengths.map((s) => (
            <li key={s.key} className="text-[13px] leading-relaxed text-charcoal">
              <span className="font-semibold text-ink">{s.name}</span>：{s.description}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 rounded-xl border border-[#B8860B]/30 bg-[#D89A3B]/[0.09] px-4 py-3.5">
        <p className="flex items-center gap-1.5 text-[13px] font-bold text-[#8A5A00]">
          <span aria-hidden="true">🌱</span>これから伸ばせる点
        </p>
        <ul className="mt-2 space-y-1.5">
          {growth.map((g) => (
            <li key={g.key} className="text-[13px] leading-relaxed text-charcoal">
              <span className="font-semibold text-ink">{g.name}</span>：{g.description}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11.5px] leading-relaxed text-sub">経験を積むほど変わっていく項目です。弱みという意味ではありません。</p>
      </div>

      {salaryBand && (
        <details className="mt-4">
          <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[12px] text-sub underline">参考情報を見る</summary>
          <p className="text-[12px] leading-relaxed text-sub">診断時に算出された想定年収帯（目安）: {salaryBand}。実際の給与・待遇を示すものではありません。</p>
        </details>
      )}
    </section>
  );
}
