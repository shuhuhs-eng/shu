"use client";

import { startTransition, useActionState, useState } from "react";
import { SaveFeedback } from "@/components/profile/save-feedback";
import {
  CAREER_PHASES, CAREER_PHASE_LABEL, GRADUATION_KINDS, GRADUATION_KIND_LABEL, LICENSE_STATUSES, LICENSE_STATUS_LABEL,
  type CareerPhaseValue,
} from "@/lib/student-diagnosis/career-phase";
import type { CareerPhaseFormState } from "@/lib/student-diagnosis/actions";

const input = "mt-1 min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 py-2 text-[14px] text-ink";

/**
 * 区分（学生・新卒・経験者）の入力。未設定のままでも他の機能は今までどおり使える。選ぶのは本人だけ。
 * 学生・新卒を選んだときだけ、卒業・就業開始・免許の欄を出す（免許の有無で区分を決めない・別々の項目）。
 */
export function CareerPhaseForm({
  initial, action,
}: {
  initial: CareerPhaseValue;
  action: (prev: CareerPhaseFormState, fd: FormData) => Promise<CareerPhaseFormState>;
}) {
  const [state, formAction, isPending] = useActionState(action, { status: "idle" } as CareerPhaseFormState);
  const [phase, setPhase] = useState<string>(initial.phase ?? "");
  const [dirty, setDirty] = useState(false);
  const fe = state.status === "error" ? state.fieldErrors ?? {} : {};
  const student = phase === "student" || phase === "new_graduate";
  return (
    <form
      onChange={() => setDirty(true)}
      onSubmit={(e) => {
        // React 19 の <form action> は処理後に入力欄を初期値へ戻す。失敗時に入力を残すため、自前で送信する（プロフィール編集と同じ方式）。
        e.preventDefault();
        if (isPending) return;
        const fd = new FormData(e.currentTarget);
        setDirty(false);
        startTransition(() => formAction(fd));
      }}
      className="space-y-4 rounded-2xl border border-line bg-surface p-5">
      <div>
        <h2 className="text-[15px] font-bold text-ink">いまの立場（任意）</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-sub">選ばなくても、他の機能は今までどおり使えます。選ばないままの場合、経験者として扱うことはありません。</p>
      </div>
      <fieldset>
        <legend className="sr-only">区分</legend>
        <div className="grid gap-2">
          <label className="flex min-h-[44px] items-center gap-2 text-[14px] text-ink">
            <input type="radio" name="phase" value="" checked={phase === ""} onChange={() => setPhase("")} /> 選ばない（未設定）
          </label>
          {CAREER_PHASES.map((p) => (
            <label key={p} className="flex min-h-[44px] items-center gap-2 text-[14px] text-ink">
              <input type="radio" name="phase" value={p} checked={phase === p} onChange={() => setPhase(p)} /> {CAREER_PHASE_LABEL[p]}
            </label>
          ))}
        </div>
        {fe.phase && <p role="alert" className="mt-1 text-[12.5px] text-[#8A2E2E]">{fe.phase}</p>}
      </fieldset>
      {student && (
        <div className="space-y-3">
          <div>
            <label className="text-[13px] font-semibold text-ink" htmlFor="cp-grad">卒業（予定）の年月</label>
            <input id="cp-grad" type="month" name="graduationYm" defaultValue={initial.graduationYm ?? ""} className={input} />
            {fe.graduationYm && <p role="alert" className="mt-1 text-[12.5px] text-[#8A2E2E]">{fe.graduationYm}</p>}
          </div>
          <div>
            <label className="text-[13px] font-semibold text-ink" htmlFor="cp-kind">卒業の区分</label>
            <select id="cp-kind" name="graduationKind" defaultValue={initial.graduationKind ?? ""} className={input}>
              <option value="">選んでください</option>
              {GRADUATION_KINDS.filter((k) => phase === "new_graduate" || k === "planned").map((k) => <option key={k} value={k}>{GRADUATION_KIND_LABEL[k]}</option>)}
            </select>
            {fe.graduationKind && <p role="alert" className="mt-1 text-[12.5px] text-[#8A2E2E]">{fe.graduationKind}</p>}
          </div>
          <div>
            <label className="text-[13px] font-semibold text-ink" htmlFor="cp-start">就業開始の希望時期（任意）</label>
            <input id="cp-start" type="month" name="desiredStartYm" defaultValue={initial.desiredStartYm ?? ""} className={input} />
            {fe.desiredStartYm && <p role="alert" className="mt-1 text-[12.5px] text-[#8A2E2E]">{fe.desiredStartYm}</p>}
          </div>
          <div>
            <label className="text-[13px] font-semibold text-ink" htmlFor="cp-lic">美容師免許の取得状況（任意）</label>
            <select id="cp-lic" name="licenseStatus" defaultValue={initial.licenseStatus ?? ""} className={input}>
              <option value="">選ばない</option>
              {LICENSE_STATUSES.map((l) => <option key={l} value={l}>{LICENSE_STATUS_LABEL[l]}</option>)}
            </select>
          </div>
        </div>
      )}
      <button type="submit" disabled={isPending} className="flex w-full items-center justify-center rounded-full bg-ink px-6 py-3.5 text-[14.5px] font-semibold text-surface disabled:opacity-50">
        {isPending ? "保存中…" : "いまの立場を保存する"}
      </button>
      <SaveFeedback success={state.status === "saved" && !dirty ? "保存しました" : undefined} error={state.status === "error" ? state.message : undefined} />
    </form>
  );
}
