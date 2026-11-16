"use client";

import { useState } from "react";
import {
  BLANK_PERIOD_UNITS, BLANK_PERIOD_UNIT_LABEL, CAREER_PHASES, CAREER_PHASE_LABEL, CAREER_PHASE_REQUIRED_HEADING, CAREER_PHASE_RESELECT_NOTE,
  GRADUATION_MONTHS, graduationYearOptions, isAllowedGraduationYm,
  type CareerPhaseErrors, type CareerPhaseValue,
} from "@/lib/student-diagnosis/career-phase";

const input = "mt-1 min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 py-2 text-[14px] text-ink";

/**
 * 「いまの立場（必須）」。新規登録（ウィザード）とプロフィール編集で同じ欄を使う（プロフィールとは別に保存できない）。
 * ・選択肢は3つだけ（新卒／現役の美容師／ブランクあり）。初期選択しない。旧データ（未設定・美容学生）は未選択として開き、選び直してもらう。
 * ・新卒: 卒業（予定）の年（西暦の選択）と月（3月／10月）の両方が必須。日・自由入力・ほかの月は出さない。
 *     既存データの卒業月が3月／10月以外のときは、丸めずに月を未選択で開き、選び直しを案内する。
 * ・ブランクあり: ブランク期間（任意）。数値（正の整数）＋単位（ヶ月／年）。空欄は未入力（0ヶ月ではない）。
 * 送信名: careerPhase / graduationYear / graduationMonth / blankPeriodValue / blankPeriodUnit
 */
export function CareerPhaseField({ defaultValue, errors }: { defaultValue: CareerPhaseValue; errors?: CareerPhaseErrors | Record<string, string[] | undefined> }) {
  const [phase, setPhase] = useState<string>(defaultValue.phase ?? "");
  const pick = (k: string): string | undefined => {
    const v = (errors as Record<string, unknown> | undefined)?.[k];
    return Array.isArray(v) ? (v[0] as string | undefined) : (v as string | undefined);
  };
  const unsetLegacy = defaultValue.phase === null;
  const years = graduationYearOptions();
  const gYear = defaultValue.graduationYm ? Number(defaultValue.graduationYm.slice(0, 4)) : null;
  const gMonth = defaultValue.graduationYm ? Number(defaultValue.graduationYm.slice(5, 7)) : null;
  const monthOk = isAllowedGraduationYm(defaultValue.graduationYm);
  // 範囲外・3月/10月以外の既存データは丸めない。年は残せるときだけ残し、月は未選択にして選び直してもらう。
  const yearDefault = gYear !== null && years.includes(gYear) ? String(gYear) : "";
  const monthDefault = monthOk && gMonth !== null ? String(gMonth) : "";
  const needReselect = defaultValue.phase === "new_graduate" && defaultValue.graduationYm !== null && !monthOk;
  return (
    <fieldset className="space-y-3" data-testid="career-phase-field">
      <legend className="text-[14px] font-semibold text-ink">{CAREER_PHASE_REQUIRED_HEADING}</legend>
      {unsetLegacy && <p className="text-[12.5px] leading-relaxed text-charcoal" data-testid="career-phase-reselect">{CAREER_PHASE_RESELECT_NOTE}</p>}
      <div className="grid gap-2">
        {CAREER_PHASES.map((p) => (
          <label key={p} className="flex min-h-[44px] items-center gap-2 text-[14px] text-ink">
            <input type="radio" name="careerPhase" value={p} checked={phase === p} onChange={() => setPhase(p)} /> {CAREER_PHASE_LABEL[p]}
          </label>
        ))}
      </div>
      {pick("careerPhase") && <p role="alert" className="text-[12.5px] text-[#8A2E2E]">{pick("careerPhase")}</p>}
      {phase === "new_graduate" && (
        <div className="space-y-2" data-testid="career-phase-graduation">
          <p className="text-[13px] font-semibold text-ink">卒業（予定）年月</p>
          {needReselect && <p className="text-[12.5px] leading-relaxed text-charcoal" data-testid="career-phase-month-reselect">保存されている卒業月は、現在選べる月（3月・10月）ではありません。年と月を選び直してください。</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12.5px] text-sub" htmlFor="cp-year">年</label>
              <select id="cp-year" name="graduationYear" defaultValue={yearDefault} className={input}>
                <option value="">選んでください</option>
                {years.map((y) => <option key={y} value={y}>{y}年</option>)}
              </select>
            </div>
            <div>
              <label className="text-[12.5px] text-sub" htmlFor="cp-month">月</label>
              <select id="cp-month" name="graduationMonth" defaultValue={monthDefault} className={input}>
                <option value="">選んでください</option>
                {GRADUATION_MONTHS.map((m) => <option key={m} value={m}>{m}月</option>)}
              </select>
            </div>
          </div>
          {pick("graduationYm") && <p role="alert" className="text-[12.5px] text-[#8A2E2E]">{pick("graduationYm")}</p>}
        </div>
      )}
      {phase === "blank" && (
        <div className="space-y-2" data-testid="career-phase-blank">
          <label className="text-[13px] font-semibold text-ink" htmlFor="cp-blank-value">ブランク期間（任意）</label>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <input id="cp-blank-value" name="blankPeriodValue" type="text" inputMode="numeric" autoComplete="off" placeholder="例: 6" defaultValue={defaultValue.blankPeriod ? String(defaultValue.blankPeriod.value) : ""} className={input} />
            <select aria-label="ブランク期間の単位" name="blankPeriodUnit" defaultValue={defaultValue.blankPeriod?.unit ?? "months"} className={`${input} !w-auto`}>
              {BLANK_PERIOD_UNITS.map((u) => <option key={u} value={u}>{BLANK_PERIOD_UNIT_LABEL[u]}</option>)}
            </select>
          </div>
          <p className="text-[12px] leading-relaxed text-sub">1以上の整数で入力してください（ヶ月は720まで、年は60まで）。空欄のままでも保存できます。</p>
          {pick("blankPeriod") && <p role="alert" className="text-[12.5px] text-[#8A2E2E]">{pick("blankPeriod")}</p>}
        </div>
      )}
    </fieldset>
  );
}
