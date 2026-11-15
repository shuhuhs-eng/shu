"use client";

import { useState } from "react";
import {
  CAREER_PHASES, CAREER_PHASE_LABEL, CAREER_PHASE_REQUIRED_HEADING, CAREER_PHASE_RESELECT_NOTE,
  GRADUATION_KINDS, GRADUATION_KIND_LABEL, LICENSE_STATUSES, LICENSE_STATUS_LABEL,
  type CareerPhaseErrors, type CareerPhaseValue,
} from "@/lib/student-diagnosis/career-phase";

const input = "mt-1 min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 py-2 text-[14px] text-ink";

/**
 * 「いまの立場（必須）」。新規登録（ウィザード）とプロフィール編集で同じ欄を使う（プロフィールとは別に保存できない）。
 * ・選択肢は3つだけ（新卒／現役の美容師／ブランクあり）。初期選択しない。旧データ（未設定・美容学生）は未選択として開き、選び直してもらう。
 * ・新卒を選んだときだけ、卒業・就業開始・免許の欄を出す（別々の項目）。
 * 送信名: careerPhase / graduationYm / graduationKind / desiredStartYm / licenseStatus
 */
export function CareerPhaseField({ defaultValue, errors }: { defaultValue: CareerPhaseValue; errors?: CareerPhaseErrors | Record<string, string[] | undefined> }) {
  const [phase, setPhase] = useState<string>(defaultValue.phase ?? "");
  const pick = (k: string): string | undefined => {
    const v = (errors as Record<string, unknown> | undefined)?.[k];
    return Array.isArray(v) ? (v[0] as string | undefined) : (v as string | undefined);
  };
  const unsetLegacy = defaultValue.phase === null;
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
        <div className="space-y-3">
          <div>
            <label className="text-[13px] font-semibold text-ink" htmlFor="cp-grad">卒業（予定）の年月</label>
            <input id="cp-grad" type="month" name="graduationYm" defaultValue={defaultValue.graduationYm ?? ""} className={input} />
            {pick("graduationYm") && <p role="alert" className="mt-1 text-[12.5px] text-[#8A2E2E]">{pick("graduationYm")}</p>}
          </div>
          <div>
            <label className="text-[13px] font-semibold text-ink" htmlFor="cp-kind">卒業の区分</label>
            <select id="cp-kind" name="graduationKind" defaultValue={defaultValue.graduationKind ?? ""} className={input}>
              <option value="">選んでください</option>
              {GRADUATION_KINDS.map((k) => <option key={k} value={k}>{GRADUATION_KIND_LABEL[k]}</option>)}
            </select>
            {pick("graduationKind") && <p role="alert" className="mt-1 text-[12.5px] text-[#8A2E2E]">{pick("graduationKind")}</p>}
          </div>
          <div>
            <label className="text-[13px] font-semibold text-ink" htmlFor="cp-start">就業開始の希望時期（任意）</label>
            <input id="cp-start" type="month" name="desiredStartYm" defaultValue={defaultValue.desiredStartYm ?? ""} className={input} />
            {pick("desiredStartYm") && <p role="alert" className="mt-1 text-[12.5px] text-[#8A2E2E]">{pick("desiredStartYm")}</p>}
          </div>
          <div>
            <label className="text-[13px] font-semibold text-ink" htmlFor="cp-lic">美容師免許の取得状況（任意）</label>
            <select id="cp-lic" name="licenseStatus" defaultValue={defaultValue.licenseStatus ?? ""} className={input}>
              <option value="">未入力</option>
              {LICENSE_STATUSES.map((l) => <option key={l} value={l}>{LICENSE_STATUS_LABEL[l]}</option>)}
            </select>
            {pick("licenseStatus") && <p role="alert" className="mt-1 text-[12.5px] text-[#8A2E2E]">{pick("licenseStatus")}</p>}
          </div>
        </div>
      )}
    </fieldset>
  );
}
