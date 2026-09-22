"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveProfileAction } from "@/lib/profile/actions";
import { initialAuthActionState } from "@/lib/auth/types";
import { SubmitButton } from "@/components/auth/submit-button";
import { PendingFieldset } from "@/components/auth/pending-fieldset";
import { FormErrorBanner } from "@/components/auth/form-messages";
import { TextField } from "@/components/auth/text-field";
import { SelectField } from "@/components/profile/select-field";
import { CheckboxGroupField } from "@/components/profile/checkbox-group-field";
import { TextareaField } from "@/components/profile/textarea-field";
import { AvatarUploader } from "@/components/profile/avatar-uploader";
import { SnsLinksField } from "@/components/profile/sns-links-field";
import { ValuePrioritySelector } from "@/components/profile/value-priority-selector";
import {
  PREFECTURES,
  SPECIALTY_OPTIONS,
  VALUE_PRIORITY_OPTIONS,
  AGE_BAND_LABELS,
  GENDER_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  JOB_CHANGE_INTENT_LABELS,
  SALARY_BAND_LABELS,
  VISIBILITY_LABELS,
} from "@/lib/validation/profile-options";
import type { ProfileFormInitialValues } from "@/components/profile/profile-form";

const STEP_LABELS = ["基本情報", "キャリア", "希望条件", "働き方・価値観"];
const TOTAL_STEPS = STEP_LABELS.length;

const toOptions = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

type Props = {
  userId: string;
  initialValues: ProfileFormInitialValues;
};

/**
 * 美容師オンボーディングの4ステップウィザード（docs/phase1-stylist-onboarding.md）。
 *
 * ・新規ルートは作らず、/onboarding 内の状態遷移としてステップを進める。
 * ・全ステップの入力欄を1つの<form>内に常にDOM上へ保持し（現在のステップ以外は
 *   hiddenクラスで非表示にするだけで、アンマウントしない）、最終ステップの
 *   「保存」でのみ既存の saveProfileAction を1回呼び出す。ステップごとの
 *   部分保存は行わない（DBへの書き込みは最終送信の1回のみ）。
 * ・保存成功後は /mypage へ遷移する。
 *
 * ★重要（過去の不具合と修正内容）:
 *   以前は各ステップの<fieldset>に対して reportValidity() を呼んで必須項目を
 *   チェックしていたが、<fieldset>要素は子孫フォームコントロールの妥当性を
 *   集約検証しない（<fieldset>自体は常に有効と判定される）ため、このチェックは
 *   実質的に機能していなかった。未入力のまま最終ステップまで進めてしまい、
 *   実際の送信（type="submit"）時に初めてブラウザ標準のフォーム全体検証が働き、
 *   非表示ステップ（display:none）の required なフィールドに引っかかって
 *   フォーカスできず、送信自体が警告のみで静かに中止される不具合があった
 *   （例: "An invalid form control with name='desiredSalaryRange' is not focusable"）。
 *
 *   対応として、
 *     1. 全フィールドからネイティブ required 属性を削除する
 *        （TextField/SelectFieldへ required={false} を明示）。
 *        これにより非表示フィールドがネイティブ検証に一切引っかからなくなる。
 *     2. 必須チェック自体は無くさず、validateStep() で各ステップの必須項目を
 *        FormDataから直接読み取ってJavaScriptで判定する方式に置き換える。
 *     3. 「次へ」押下時は現在のステップのみ検証する。
 *     4. 実際の送信（onSubmit）でも全ステップを対象に最終チェックを行い、
 *        問題があれば preventDefault() して該当ステップへ戻す
 *        （二重の安全網。通常は各ステップの「次へ」で既に検証済みのはず）。
 *     5. サーバー側の profileFormSchema（zod）による最終検証は変更していない
 *        （クライアント側チェックはUXのためのものであり、セキュリティ上の
 *        防御線は引き続きサーバー側のzod検証）。
 */
export function StylistOnboardingWizard({ userId, initialValues }: Props) {
  const router = useRouter();
  const [state, formAction] = useActionState(saveProfileAction, initialAuthActionState);
  const [step, setStep] = useState(1);
  const [stepError, setStepError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      router.push("/stylist/mypage");
    }
  }, [state.success, router]);

  /**
   * 指定ステップの必須項目が埋まっているかを、現在のフォーム全体のFormDataから
   * 直接読み取って判定する（ネイティブHTML5バリデーションには一切依存しない）。
   * 問題があればエラーメッセージを、無ければnullを返す。
   */
  function validateStep(targetStep: number): string | null {
    if (!formRef.current) return null;
    const fd = new FormData(formRef.current);
    const get = (name: string) => String(fd.get(name) ?? "").trim();

    if (targetStep === 1) {
      if (!get("publicName")) return "公開名を入力してください";
      if (!get("prefecture")) return "都道府県を選択してください";
      if (!get("fullName")) return "氏名を入力してください";
      if (!get("ageBand")) return "年代を選択してください";
      if (!get("gender")) return "性別を選択してください";
      return null;
    }
    if (targetStep === 2) {
      if (!get("experienceYears")) return "美容師経験年数を入力してください";
      if (fd.getAll("specialties").length === 0) return "得意技術を1つ以上選択してください";
      if (!get("employmentType")) return "現在の雇用形態を選択してください";
      return null;
    }
    if (targetStep === 3) {
      if (!get("desiredSalaryRange")) return "希望年収帯を選択してください";
      return null;
    }
    if (targetStep === 4) {
      if (fd.getAll("valuePriorities").length !== 3) return "重要な項目を3つ選択してください";
      return null;
    }
    return null;
  }

  function handleNext() {
    const error = validateStep(step);
    if (error) {
      setStepError(error);
      return;
    }
    setStepError(null);
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }

  function handleBack() {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 1));
  }

  /**
   * 実際の送信時の最終防御。通常は各ステップの「次へ」で既に検証済みだが、
   * 念のため全ステップを対象に再チェックし、問題があれば送信を中止して
   * 該当ステップへ戻す。
   */
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    for (let s = 1; s <= TOTAL_STEPS; s++) {
      const error = validateStep(s);
      if (error) {
        e.preventDefault();
        setStep(s);
        setStepError(error);
        return;
      }
    }
    setStepError(null);
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="space-y-8">
      <FormErrorBanner message={state.error} />

      <div className="mb-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="eyebrow">
            ステップ {step} / {TOTAL_STEPS}：{STEP_LABELS[step - 1]}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface2">
          <div
            className="h-full rounded-full bg-ink transition-all"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </div>

      {stepError && (
        <p role="alert" className="rounded-xl border border-[#C24545]/30 bg-[#C24545]/10 px-4 py-3 text-[13px] text-[#8A2E2E]">
          {stepError}
        </p>
      )}

      <PendingFieldset>
        <div>
          {/* ステップ1: 基本情報 */}
          <div className={step === 1 ? "space-y-4" : "hidden"}>
            <AvatarUploader
              userId={userId}
              initialPath={initialValues.avatarPath}
              initialSignedUrl={initialValues.avatarSignedUrl}
              errors={state.fieldErrors?.avatarPath}
            />
            <TextField
              id="publicName"
              name="publicName"
              label="公開名"
              required={false}
              defaultValue={initialValues.publicName}
              errors={state.fieldErrors?.publicName}
            />
            <SelectField
              id="prefecture"
              name="prefecture"
              label="都道府県"
              placeholder="選択してください"
              required={false}
              defaultValue={initialValues.prefecture}
              options={PREFECTURES.map((p) => ({ value: p, label: p }))}
              errors={state.fieldErrors?.prefecture}
            />
            <TextField
              id="fullName"
              name="fullName"
              label="氏名（サロンへ自動公開されません）"
              required={false}
              defaultValue={initialValues.fullName}
              errors={state.fieldErrors?.fullName}
            />
            <SelectField
              id="ageBand"
              name="ageBand"
              label="年代（サロンへ自動公開されません）"
              placeholder="選択してください"
              required={false}
              defaultValue={initialValues.ageBand}
              options={toOptions(AGE_BAND_LABELS)}
              errors={state.fieldErrors?.ageBand}
            />
            <SelectField
              id="gender"
              name="gender"
              label="性別（サロンへ自動公開されません）"
              placeholder="選択してください"
              required={false}
              defaultValue={initialValues.gender}
              options={toOptions(GENDER_LABELS)}
              errors={state.fieldErrors?.gender}
            />
          </div>

          {/* ステップ2: キャリア */}
          <div className={step === 2 ? "space-y-4" : "hidden"}>
            <TextField
              id="experienceYears"
              name="experienceYears"
              label="美容師経験年数"
              type="number"
              required={false}
              defaultValue={initialValues.experienceYears}
              errors={state.fieldErrors?.experienceYears}
            />
            <TextField
              id="currentPosition"
              name="currentPosition"
              label="現在の役職（任意）"
              required={false}
              defaultValue={initialValues.currentPosition}
              errors={state.fieldErrors?.currentPosition}
            />
            <CheckboxGroupField
              name="specialties"
              label="得意技術"
              options={SPECIALTY_OPTIONS}
              defaultValues={initialValues.specialties}
              errors={state.fieldErrors?.specialties}
            />
            <SelectField
              id="employmentType"
              name="employmentType"
              label="現在の雇用形態"
              placeholder="選択してください"
              required={false}
              defaultValue={initialValues.employmentType}
              options={toOptions(EMPLOYMENT_TYPE_LABELS)}
              errors={state.fieldErrors?.employmentType}
            />
            <SnsLinksField defaultValues={initialValues.snsLinks} />
          </div>

          {/* ステップ3: 希望条件 */}
          <div className={step === 3 ? "space-y-4" : "hidden"}>
            <TextField
              id="desiredWorkLocation"
              name="desiredWorkLocation"
              label="希望勤務地（任意）"
              required={false}
              defaultValue={initialValues.desiredWorkLocation}
              errors={state.fieldErrors?.desiredWorkLocation}
            />
            <SelectField
              id="jobChangeIntent"
              name="jobChangeIntent"
              label="転職意欲"
              required={false}
              defaultValue={initialValues.jobChangeIntent}
              options={toOptions(JOB_CHANGE_INTENT_LABELS)}
              errors={state.fieldErrors?.jobChangeIntent}
            />
            <SelectField
              id="desiredSalaryRange"
              name="desiredSalaryRange"
              label="希望年収帯"
              placeholder="選択してください"
              required={false}
              defaultValue={initialValues.desiredSalaryRange}
              options={toOptions(SALARY_BAND_LABELS)}
              errors={state.fieldErrors?.desiredSalaryRange}
            />
          </div>

          {/* ステップ4: 働き方・価値観 */}
          <div className={step === 4 ? "space-y-4" : "hidden"}>
            <ValuePrioritySelector
              name="valuePriorities"
              label="サロン選びで大切にしたいこと"
              options={VALUE_PRIORITY_OPTIONS}
              defaultValues={initialValues.valuePriorities}
              errors={state.fieldErrors?.valuePriorities}
            />
            <TextareaField
              id="bio"
              name="bio"
              label="自己紹介（任意）"
              defaultValue={initialValues.bio}
              maxLength={1000}
              errors={state.fieldErrors?.bio}
            />
            <SelectField
              id="visibility"
              name="visibility"
              label="プロフィールの公開範囲"
              required={false}
              defaultValue={initialValues.visibility}
              options={toOptions(VISIBILITY_LABELS)}
              errors={state.fieldErrors?.visibility}
            />
            <SelectField
              id="scoutEnabled"
              name="scoutEnabled"
              label="スカウト受信設定"
              required={false}
              defaultValue={String(initialValues.scoutEnabled)}
              options={[
                { value: "true", label: "スカウトを受け取る" },
                { value: "false", label: "スカウトを受け取らない" },
              ]}
              errors={state.fieldErrors?.scoutEnabled}
            />
            <p className="text-[12.5px] text-sub">入力内容は後からいつでも変更できます。</p>
          </div>
        </div>
      </PendingFieldset>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleBack}
          disabled={step === 1}
          className="text-[13px] font-semibold text-sub underline disabled:opacity-0"
        >
          戻る
        </button>

        {step < TOTAL_STEPS ? (
          <button
            type="button"
            onClick={handleNext}
            className="flex items-center justify-center rounded-full bg-ink px-8 py-3 text-[14px] font-semibold text-surface"
          >
            次へ
          </button>
        ) : (
          <SubmitButton pendingText="保存中...">プロフィールを保存して始める</SubmitButton>
        )}
      </div>
    </form>
  );
}
