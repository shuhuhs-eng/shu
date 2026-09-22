"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveStylistMatchProfile } from "@/lib/match-profile/actions";
import { CAREER_GOALS, CAREER_STAGES, type CareerStageCode } from "@/lib/match-profile/options";
import type { Database } from "@/types/database";

type Row = Database["public"]["Tables"]["stylist_match_profiles"]["Row"];
type NumberKey = "avgMonthlyTechnicalSales" | "avgMonthlyRetailSales" | "avgMonthlyClients" |
  "avgMonthlyNamedClients" | "averageTicket" | "repeatRate" | "monthlyWorkingDays" |
  "averageDailyHours" | "selfAcquiredClients" | "expectedTransferClients";

const numberFields: { key: NumberKey; label: string; unit: string; required?: boolean }[] = [
  { key: "avgMonthlyTechnicalSales", label: "月平均の技術売上", unit: "円", required: true },
  { key: "avgMonthlyRetailSales", label: "月平均の店販売上", unit: "円" },
  { key: "avgMonthlyClients", label: "月平均の担当客数", unit: "名", required: true },
  { key: "avgMonthlyNamedClients", label: "月平均の指名客数", unit: "名" },
  { key: "averageTicket", label: "平均客単価", unit: "円" },
  { key: "repeatRate", label: "再来率", unit: "%" },
  { key: "monthlyWorkingDays", label: "月平均の出勤日数", unit: "日", required: true },
  { key: "averageDailyHours", label: "1日の平均勤務時間", unit: "時間" },
  { key: "selfAcquiredClients", label: "自力集客した月平均客数", unit: "名" },
  { key: "expectedTransferClients", label: "転職後も来店が見込まれる顧客", unit: "名" },
];

function nullableNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function MatchProfileWizard({ initialProfile }: { initialProfile: Row | null }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [primaryGoal, setPrimaryGoal] = useState(initialProfile?.primary_goal ?? "");
  const [secondaryGoals, setSecondaryGoals] = useState<string[]>(initialProfile?.secondary_goals ?? []);
  const [careerStage, setCareerStage] = useState<CareerStageCode | "">((initialProfile?.career_stage as CareerStageCode) ?? "");
  const [wantsPerformanceOffer, setWantsPerformanceOffer] = useState(initialProfile?.wants_performance_offer ?? false);
  const [evidencePeriodMonths, setEvidencePeriodMonths] = useState<number | null>(initialProfile?.evidence_period_months ?? 6);
  const [values, setValues] = useState<Record<NumberKey, number | null>>({
    avgMonthlyTechnicalSales: initialProfile?.avg_monthly_technical_sales ?? null,
    avgMonthlyRetailSales: initialProfile?.avg_monthly_retail_sales ?? null,
    avgMonthlyClients: initialProfile?.avg_monthly_clients ?? null,
    avgMonthlyNamedClients: initialProfile?.avg_monthly_named_clients ?? null,
    averageTicket: initialProfile?.average_ticket ?? null,
    repeatRate: initialProfile?.repeat_rate ?? null,
    monthlyWorkingDays: initialProfile?.monthly_working_days ?? null,
    averageDailyHours: initialProfile?.average_daily_hours ?? null,
    selfAcquiredClients: initialProfile?.self_acquired_clients ?? null,
    expectedTransferClients: initialProfile?.expected_transfer_clients ?? null,
  });
  const [assistantUsage, setAssistantUsage] = useState(initialProfile?.assistant_usage ?? "none");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleSecondary(code: string) {
    if (code === primaryGoal) return;
    setSecondaryGoals((current) => current.includes(code)
      ? current.filter((item) => item !== code)
      : current.length < 2 ? [...current, code] : current);
  }

  function next() {
    setError(null);
    if (step === 0 && !primaryGoal) return setError("一番変えたいことを選んでください。");
    if (step === 1 && !careerStage) return setError("現在のキャリア段階を選んでください。");
    if (step === 1 && careerStage !== "results_stylist") return void save(false);
    if (step === 2 && !wantsPerformanceOffer) return void save(false);
    setStep((current) => Math.min(current + 1, 3));
  }

  async function save(offerOverride?: boolean) {
    if (!primaryGoal || !careerStage) return;
    setSaving(true);
    setError(null);
    const offerEnabled = offerOverride ?? (careerStage === "results_stylist" && wantsPerformanceOffer);
    const result = await saveStylistMatchProfile({
      primaryGoal, secondaryGoals, careerStage, wantsPerformanceOffer: offerEnabled,
      evidencePeriodMonths: offerEnabled ? evidencePeriodMonths as 3 | 6 | 12 | null : null,
      avgMonthlyTechnicalSales: offerEnabled ? values.avgMonthlyTechnicalSales : null,
      avgMonthlyRetailSales: offerEnabled ? values.avgMonthlyRetailSales : null,
      avgMonthlyClients: offerEnabled ? values.avgMonthlyClients : null,
      avgMonthlyNamedClients: offerEnabled ? values.avgMonthlyNamedClients : null,
      averageTicket: offerEnabled ? values.averageTicket : null,
      repeatRate: offerEnabled ? values.repeatRate : null,
      monthlyWorkingDays: offerEnabled ? values.monthlyWorkingDays : null,
      averageDailyHours: offerEnabled ? values.averageDailyHours : null,
      selfAcquiredClients: offerEnabled ? values.selfAcquiredClients : null,
      expectedTransferClients: offerEnabled ? values.expectedTransferClients : null,
      assistantUsage: offerEnabled ? assistantUsage as "none" | "shared" | "dedicated" : null,
    });
    setSaving(false);
    if (!result.success) return setError(result.error);
    router.push(offerEnabled ? "/stylist/match-profile?saved=1#evidence" : "/stylist/mypage");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex justify-between"><span className="eyebrow">{step + 1} / 4</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface2">
          <div className="h-full rounded-full bg-ink" style={{ width: `${((step + 1) / 4) * 100}%` }} />
        </div>
      </div>
      {error && <p role="alert" className="rounded-xl border border-[#C24545]/30 bg-[#C24545]/10 px-4 py-3 text-[13px] text-[#8A2E2E]">{error}</p>}

      {step === 0 && <div>
        <h2 className="font-serif text-xl font-bold text-ink">今回の転職で、一番変えたいことは？</h2>
        <p className="mt-2 text-[12.5px] text-sub">最重要を1つ、そのほかに大切なことを2つまで選べます。</p>
        <div className="mt-5 grid gap-2">
          {CAREER_GOALS.map((goal) => {
            const primary = primaryGoal === goal.code;
            const secondary = secondaryGoals.includes(goal.code);
            return <div key={goal.code} className={`rounded-xl border p-3 ${primary || secondary ? "border-ink bg-surface2" : "border-line bg-surface"}`}>
              <button type="button" onClick={() => { setPrimaryGoal(goal.code); setSecondaryGoals((v) => v.filter((x) => x !== goal.code)); }} className="w-full text-left text-[13px] font-semibold text-ink">
                <span className="mr-2">{primary ? "●" : "○"}</span>{goal.label}
              </button>
              {!primary && <button type="button" onClick={() => toggleSecondary(goal.code)} className="mt-2 text-[11.5px] text-sub underline">
                {secondary ? "重要から外す" : "これも重要"}
              </button>}
            </div>;
          })}
        </div>
      </div>}

      {step === 1 && <div>
        <h2 className="font-serif text-xl font-bold text-ink">現在のキャリアに近いものは？</h2>
        <div className="mt-5 space-y-3">{CAREER_STAGES.map((stage) => <button key={stage.code} type="button" onClick={() => setCareerStage(stage.code)} className={`w-full rounded-xl border p-4 text-left ${careerStage === stage.code ? "border-ink bg-surface2" : "border-line bg-surface"}`}>
          <span className="text-[14px] font-bold text-ink">{stage.label}</span><span className="mt-1 block text-[12px] text-sub">{stage.note}</span>
        </button>)}</div>
      </div>}

      {step === 2 && <div>
        <h2 className="font-serif text-xl font-bold text-ink">実績をもとに給与条件を相談しますか？</h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-sub">希望する方だけ利用できます。通常のマッチングには影響しません。</p>
        <div className="mt-5 space-y-3">
          <button type="button" onClick={() => setWantsPerformanceOffer(false)} className={`w-full rounded-xl border p-4 text-left ${!wantsPerformanceOffer ? "border-ink bg-surface2" : "border-line bg-surface"}`}><span className="text-[14px] font-bold text-ink">通常の条件で相談する</span><span className="mt-1 block text-[12px] text-sub">売上や給与資料の入力は不要です。</span></button>
          <button type="button" onClick={() => setWantsPerformanceOffer(true)} className={`w-full rounded-xl border p-4 text-left ${wantsPerformanceOffer ? "border-ink bg-surface2" : "border-line bg-surface"}`}><span className="text-[14px] font-bold text-ink">実績オファーを希望する</span><span className="mt-1 block text-[12px] text-sub">実績資料を確認後、サロンから根拠のある条件提示を受けられます。</span></button>
        </div>
      </div>}

      {step === 3 && <div>
        <h2 className="font-serif text-xl font-bold text-ink">現在の実績を教えてください</h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-sub">分かる範囲で入力してください。交渉時には資料確認済みかを別に表示します。</p>
        <label className="mt-5 block text-[12px] font-semibold text-charcoal">集計期間</label>
        <div className="mt-2 grid grid-cols-3 gap-2">{[3,6,12].map((months) => <button key={months} type="button" onClick={() => setEvidencePeriodMonths(months)} className={`rounded-full border px-3 py-2 text-[12px] font-semibold ${evidencePeriodMonths === months ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink"}`}>直近{months}か月</button>)}</div>
        <div className="mt-5 grid gap-4">{numberFields.map((field) => <label key={field.key} className="block">
          <span className="text-[12px] font-semibold text-charcoal">{field.label}{field.required && " *"}</span>
          <div className="mt-1 flex items-center gap-2"><input type="number" min="0" step={field.key === "averageDailyHours" ? "0.5" : "1"} value={values[field.key] ?? ""} onChange={(e) => setValues((current) => ({ ...current, [field.key]: nullableNumber(e.target.value) }))} className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 py-3 text-[14px] text-ink" /><span className="w-10 text-[12px] text-sub">{field.unit}</span></div>
        </label>)}</div>
        <label className="mt-5 block text-[12px] font-semibold text-charcoal">アシスタントの使用状況</label>
        <select value={assistantUsage} onChange={(e) => setAssistantUsage(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface px-4 py-3 text-[14px] text-ink">
          <option value="none">使用していない・マンツーマン</option><option value="shared">複数人で共有</option><option value="dedicated">専属または常時サポートあり</option>
        </select>
      </div>}

      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || saving} className="text-[13px] font-semibold text-sub underline disabled:opacity-0">戻る</button>
        <button type="button" onClick={step === 3 ? () => save() : next} disabled={saving} className="rounded-full bg-ink px-8 py-3 text-[14px] font-semibold text-surface disabled:opacity-60">{saving ? "保存中..." : step === 3 || (step === 2 && !wantsPerformanceOffer) || (step === 1 && careerStage !== "results_stylist" && careerStage !== "") ? "完了する" : "次へ"}</button>
      </div>
    </div>
  );
}
