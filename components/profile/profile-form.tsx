"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveProfileAction } from "@/lib/profile/actions";
import { initialAuthActionState } from "@/lib/auth/types";
import { SaveFeedback } from "@/components/profile/save-feedback";
import { TextField } from "@/components/auth/text-field";
import { SelectField } from "@/components/profile/select-field";
import { CheckboxGroupField } from "@/components/profile/checkbox-group-field";
import { TextareaField } from "@/components/profile/textarea-field";
import { AvatarUploader } from "@/components/profile/avatar-uploader";
import { SnsLinksField } from "@/components/profile/sns-links-field";
import { ValuePrioritySelector } from "@/components/profile/value-priority-selector";
import { BirthDateField } from "@/components/profile/birth-date-field";
import { AgeDisplayModeField } from "@/components/profile/age-display-mode-field";
import { VisibilityField } from "@/components/profile/visibility-field";
import { profileFieldsKey } from "@/lib/profile/fields-key";
import {
  PREFECTURES,
  SPECIALTY_OPTIONS,
  VALUE_PRIORITY_OPTIONS,
  AGE_BAND_LABELS,
  GENDER_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  JOB_CHANGE_INTENT_LABELS,
} from "@/lib/validation/profile-options";
import type {
  AgeBand,
  AgeDisplayMode,
  EmploymentType,
  GenderType,
  JobChangeIntent,
  SnsLink,
} from "@/types/database";

export type ProfileFormInitialValues = {
  publicName: string;
  fullName: string;
  ageBand: AgeBand | "";
  gender: GenderType | "";
  /** 生年月日（YYYY-MM-DD）。未登録は空文字。 */
  birthDate: string;
  /** DBが生年月日に対応しているときだけtrue（0070適用前は入力欄を出さない）。 */
  birthDateSupported: boolean;
  /** 生年月日の読み込みに失敗した（未対応ではない）。入力欄は出さず、保存でも生年月日は変更しない。 */
  birthDateLoadFailed: boolean;
  /** 年齢の表示方法（本人の選択）。未選択は空文字（既存会員を勝手に実年齢表示にしない）。 */
  ageDisplayMode: AgeDisplayMode | "";
  prefecture: string;
  desiredWorkLocation: string;
  experienceYears: string;
  currentPosition: string;
  specialties: string[];
  employmentType: EmploymentType | "";
  jobChangeIntent: JobChangeIntent;
  snsLinks: SnsLink[];
  bio: string;
  avatarPath: string | null;
  avatarSignedUrl: string | null;
  /** 画面で選べるのは公開／非公開のみ（既存の一部公開は非公開として表示）。 */
  visibility: "PUBLIC" | "PRIVATE";
  valuePriorities: string[];
};

type Props = {
  mode: "create" | "edit";
  userId: string;
  initialValues: ProfileFormInitialValues;
};

const toOptions = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

/** 保存完了の文言（ボタン直下に表示）。 */
export const PROFILE_SAVED_MESSAGE = "保存しました";

export function ProfileForm({ mode, userId, initialValues }: Props) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(saveProfileAction, initialAuthActionState);
  // 成功メッセージを消した（再編集を始めた）時点の state。同じ state の成功メッセージは再表示しない。
  const [dismissedFor, setDismissedFor] = useState<unknown>(null);
  const submittingRef = useRef(false);

  // 初回オンボーディングは保存完了後にマイページへ遷移する。編集画面はその場に留まり、ボタン直下に成功メッセージを表示する。
  useEffect(() => {
    if (mode === "create" && state.success) {
      router.push("/stylist/mypage");
    }
  }, [mode, state.success, router]);

  // 送信が終わったら、二重送信のガードを外す。
  useEffect(() => {
    if (!isPending) submittingRef.current = false;
  }, [isPending, state]);

  // <form action> ではなく onSubmit から直接送る。<form action> は完了後に入力欄を初期値へ戻す（React 19）ため、
  // 失敗したときに入力内容が消えてしまう。ここでは入力欄に触れないので、失敗しても入力内容が残る。
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isPending || submittingRef.current) return; // 二重送信の防止
    submittingRef.current = true;
    const formData = new FormData(e.currentTarget);
    startTransition(() => {
      formAction(formData);
    });
  }

  // 成功の表示は、実際の保存成功後だけ（保存中は出さない）。再編集を始めたら消す。
  const successMessage =
    mode === "edit" && !isPending && state.success && dismissedFor !== state ? PROFILE_SAVED_MESSAGE : undefined;
  const errorMessage = isPending ? undefined : state.error;
  const dismissSuccess = () => {
    if (state.success) setDismissedFor(state);
  };

  return (
    <form onSubmit={handleSubmit} onChange={dismissSuccess} onInput={dismissSuccess} className="space-y-8">
      <fieldset disabled={isPending} key={profileFieldsKey(initialValues)} className="contents m-0 border-0 p-0">
        <div className="space-y-8">
          <section className="space-y-4">
            <h2 className="eyebrow">公開プロフィール</h2>
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
              defaultValue={initialValues.publicName}
              errors={state.fieldErrors?.publicName}
            />
            <SelectField
              id="prefecture"
              name="prefecture"
              label="都道府県"
              placeholder="選択してください"
              defaultValue={initialValues.prefecture}
              options={PREFECTURES.map((p) => ({ value: p, label: p }))}
              errors={state.fieldErrors?.prefecture}
            />
            <TextField
              id="desiredWorkLocation"
              name="desiredWorkLocation"
              label="希望勤務地（任意）"
              required={false}
              defaultValue={initialValues.desiredWorkLocation}
              errors={state.fieldErrors?.desiredWorkLocation}
            />
            <TextField
              id="experienceYears"
              name="experienceYears"
              label="美容師経験年数"
              type="number"
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
              defaultValue={initialValues.employmentType}
              options={toOptions(EMPLOYMENT_TYPE_LABELS)}
              errors={state.fieldErrors?.employmentType}
            />
            <SelectField
              id="jobChangeIntent"
              name="jobChangeIntent"
              label="転職意欲"
              defaultValue={initialValues.jobChangeIntent}
              options={toOptions(JOB_CHANGE_INTENT_LABELS)}
              errors={state.fieldErrors?.jobChangeIntent}
            />
            <SnsLinksField defaultValues={initialValues.snsLinks} />
            <TextareaField
              id="bio"
              name="bio"
              label="自己紹介（任意）"
              defaultValue={initialValues.bio}
              maxLength={1000}
              errors={state.fieldErrors?.bio}
            />
          </section>

          <section className="space-y-4">
            <h2 className="eyebrow">本人情報（サロンへは表示されません）</h2>
            <p className="text-[12px] leading-relaxed text-sub">サロンに表示される名前は、上の「公開名」です。ここで入力する氏名・性別・年代は、ご本人の確認用で、サロンには表示されません。生年月日はご本人だけが確認でき、公開中のときサロンには満年齢だけが表示されます。</p>
            <TextField
              id="fullName"
              name="fullName"
              label="氏名"
              defaultValue={initialValues.fullName}
              errors={state.fieldErrors?.fullName}
            />
            <SelectField
              id="ageBand"
              name="ageBand"
              label="年代"
              placeholder="選択してください"
              defaultValue={initialValues.ageBand}
              options={toOptions(AGE_BAND_LABELS)}
              errors={state.fieldErrors?.ageBand}
            />
            <SelectField
              id="gender"
              name="gender"
              label="性別"
              placeholder="選択してください"
              defaultValue={initialValues.gender}
              options={toOptions(GENDER_LABELS)}
              errors={state.fieldErrors?.gender}
            />
            {initialValues.birthDateLoadFailed && (
              <p role="alert" className="rounded-xl border border-line bg-surface2 px-4 py-3 text-[12.5px] leading-relaxed text-charcoal">
                生年月日を読み込めませんでした。通信状況を確認して、ページを再読み込みしてください（この間、生年月日は変更されません）。
              </p>
            )}
            {initialValues.birthDateSupported && (
              <>
                <BirthDateField defaultValue={initialValues.birthDate} errors={state.fieldErrors?.birthDate} />
                <AgeDisplayModeField defaultValue={initialValues.ageDisplayMode} errors={state.fieldErrors?.ageDisplayMode} />
              </>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="eyebrow">働き方・価値観</h2>
            <ValuePrioritySelector
              name="valuePriorities"
              label="サロン選びで大切にしたいこと"
              options={VALUE_PRIORITY_OPTIONS}
              defaultValues={initialValues.valuePriorities}
              errors={state.fieldErrors?.valuePriorities}
            />
          </section>

          <section className="space-y-4">
            <h2 className="eyebrow">公開範囲</h2>
            <VisibilityField defaultValue={initialValues.visibility} errors={state.fieldErrors?.visibility} />
            <p className="text-[12px] leading-relaxed text-sub">公開にすると、サービス内のスカウトを受け取れます。氏名・性別・年代・生年月日は、公開にしてもサロンへ表示されません（年齢は満年齢のみ表示）。</p>
          </section>
        </div>
      </fieldset>

      <div>
        <button
          type="submit"
          disabled={isPending}
          aria-busy={isPending}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface transition-opacity disabled:opacity-60"
        >
          {isPending ? "保存中…" : mode === "create" ? "プロフィールを保存して始める" : "変更を保存"}
        </button>
        <SaveFeedback success={successMessage} error={errorMessage} />
      </div>
    </form>
  );
}
