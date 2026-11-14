import Link from "next/link";
import { CAREER_GOAL_LABELS, CAREER_STAGES, type CareerGoalCode } from "@/lib/match-profile/options";

type Props = {
  /** 登録済みの内容。未登録（または未完了）の場合は null。 */
  profile: { primary_goal: string; secondary_goals: string[]; career_stage: string } | null;
  /** 8タイプの名称（照合の説明に使う）。 */
  coreTypeName?: string | null;
  loadFailed?: boolean;
};

const GOAL_VISUAL: Record<CareerGoalCode, { icon: string; tint: string; group: string }> = {
  fair_evaluation: { icon: "⚖️", tint: "#B8860B", group: "収入・評価" },
  keep_clients: { icon: "🤝", tint: "#CE6B4F", group: "お客様" },
  increase_clients: { icon: "👥", tint: "#CE6B4F", group: "お客様" },
  higher_unit_price: { icon: "💎", tint: "#B8860B", group: "収入・評価" },
  income_growth: { icon: "💰", tint: "#B8860B", group: "収入・評価" },
  more_days_off: { icon: "🏖️", tint: "#2B4A7E", group: "働き方" },
  flexible_hours: { icon: "🕐", tint: "#2B4A7E", group: "働き方" },
  education_growth: { icon: "📚", tint: "#2E8B7F", group: "成長" },
  management_career: { icon: "🧭", tint: "#2E8B7F", group: "成長" },
  independence: { icon: "🏁", tint: "#2E8B7F", group: "成長" },
  personal_brand: { icon: "📱", tint: "#6E4AA6", group: "発信" },
  better_relationships: { icon: "🌿", tint: "#B23A6B", group: "環境" },
};

function GoalChip({ code, primary }: { code: string; primary?: boolean }) {
  const v = GOAL_VISUAL[code as CareerGoalCode];
  const label = CAREER_GOAL_LABELS[code as CareerGoalCode];
  if (!v || !label) return null;
  return (
    <li
      className="flex items-start gap-2 rounded-xl border px-3 py-2 text-[12.5px] leading-snug"
      style={{ borderColor: `${v.tint}66`, background: `${v.tint}${primary ? "1A" : "0D"}` }}
    >
      <span aria-hidden="true" className="text-[15px]">{v.icon}</span>
      <span className="text-charcoal">
        {primary && <span className="mr-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: v.tint }}>いちばん</span>}
        <span className={primary ? "font-semibold text-ink" : ""}>{label}</span>
        <span className="ml-1.5 text-[10.5px] text-sub">（{v.group}）</span>
      </span>
    </li>
  );
}

/**
 * オーダーメイドマッチ（図解）。実際に登録した回答だけを使い、関係を3ステップで示す:
 *   ①あなたが登録した「変えたいこと」と現在のステージ → ②サロン側の条件と照らし合わせ → ③店舗ごとの相性として表示
 * 登録した内容に無い理由・数値は作らない。相性の数値はサロンごとにDBで計算された結果で、ここでは表示しない。
 */
export function OrderMadeMatchCard({ profile, coreTypeName, loadFailed = false }: Props) {
  const stage = profile ? CAREER_STAGES.find((s) => s.code === profile.career_stage) : null;
  const goals = profile ? profile.secondary_goals.filter((g) => g !== profile.primary_goal) : [];

  return (
    <section className="rounded-2xl border border-[#B8860B]/30 bg-gradient-to-b from-[#FBF5E6] to-surface p-6">
      <p className="eyebrow mb-1">オーダーメイドマッチ</p>
      <p className="text-[12.5px] leading-relaxed text-charcoal">あなたの希望と、サロンの特徴を照らし合わせて、相性を見つけます。</p>

      <ol className="mt-4 space-y-3">
        <li className="rounded-xl border border-[#2E8B7F]/35 bg-[#2E8B7F]/[0.06] p-4">
          <p className="flex items-center gap-2 text-[12px] font-bold text-[#1F6B61]">
            <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2E8B7F] text-[11px] text-white">1</span>
            あなたが登録した回答
          </p>
          {loadFailed ? (
            <p className="mt-2 text-[12.5px] text-charcoal">登録内容を読み込めませんでした。画面を更新してもう一度お試しください。</p>
          ) : profile ? (
            <div className="mt-2 space-y-2">
              <ul className="space-y-1.5">
                <GoalChip code={profile.primary_goal} primary />
                {goals.map((g) => (
                  <GoalChip key={g} code={g} />
                ))}
              </ul>
              {stage && (
                <p className="rounded-lg bg-surface px-3 py-2 text-[12px] text-charcoal">
                  <span aria-hidden="true">🎯 </span>いまのステージ: <span className="font-semibold text-ink">{stage.label}</span>
                </p>
              )}
              {coreTypeName && (
                <p className="rounded-lg bg-surface px-3 py-2 text-[12px] text-charcoal">
                  <span aria-hidden="true">🪞 </span>診断タイプ: <span className="font-semibold text-ink">{coreTypeName}</span>
                </p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-[12.5px] leading-relaxed text-charcoal">まだ登録していません。「一番変えたいこと」と「いまのステージ」を登録すると、ここに表示されます。</p>
          )}
        </li>

        <li aria-hidden="true" className="text-center text-[18px] leading-none text-[#B8860B]">↓</li>

        <li className="rounded-xl border border-[#2B4A7E]/35 bg-[#2B4A7E]/[0.06] p-4">
          <p className="flex items-center gap-2 text-[12px] font-bold text-[#2B4A7E]">
            <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2B4A7E] text-[11px] text-white">2</span>
            サロンの特徴と照らし合わせ
          </p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-charcoal">サロンが答えた「サロンらしさ」や、働き方・教育などの条件と、あなたの回答を比べます。</p>
        </li>

        <li aria-hidden="true" className="text-center text-[18px] leading-none text-[#B8860B]">↓</li>

        <li className="rounded-xl border border-[#B23A6B]/35 bg-[#B23A6B]/[0.06] p-4">
          <p className="flex items-center gap-2 text-[12px] font-bold text-[#8F2A55]">
            <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-[#B23A6B] text-[11px] text-white">3</span>
            店舗ごとの相性として表示
          </p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-charcoal">公開中の店舗の一覧で、店舗ごとの相性が確認できます。</p>
          <Link href="/stylist/salons" className="mt-2 inline-flex min-h-[44px] items-center text-[12.5px] font-semibold text-ink underline">
            公開中の店舗を探す →
          </Link>
        </li>
      </ol>

      <Link
        href="/stylist/match-profile"
        className="mt-5 flex min-h-[48px] w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-3.5 text-[14px] font-semibold text-ink"
      >
        {profile ? "登録内容を見直す" : "希望条件を登録する"}
      </Link>
    </section>
  );
}
