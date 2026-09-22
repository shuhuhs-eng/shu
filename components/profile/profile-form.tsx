"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { saveProfileAction } from "@/lib/profile/actions";
import { initialAuthActionState } from "@/lib/auth/types";
import { SubmitButton } from "@/components/auth/submit-button";
import { PendingFieldset } from "@/components/auth/pending-fieldset";
import { FormErrorBanner, FormSuccessBanner } from "@/components/auth/form-messages";
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
import type {
  AgeBand,
  EmploymentType,
  GenderType,
  JobChangeIntent,
  ProfileVisibility,
  SalaryBand,
  SnsLink,
} from "@/types/database";

export type ProfileFormInitialValues = {
  publicName: string;
  fullName: string;
  ageBand: AgeBand | "";
  gender: GenderType | "";
  prefecture: string;
  desiredWorkLocation: string;
  experienceYears: string;
  currentPosition: string;
  specialties: string[];
  employmentType: EmploymentType | "";
  jobChangeIntent: JobChangeIntent;
  desiredSalaryRange: SalaryBand | "";
  snsLinks: SnsLink[];
  bio: string;
  avatarPath: string | null;
  avatarSignedUrl: string | null;
  scoutEnabled: boolean;
  visibility: ProfileVisibility;
  valuePriorities: string[];
};

type Props = {
  mode: "create" | "edit";
  userId: string;
  initialValues: ProfileFormInitialValues;
};

const toOptions = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

export function ProfileForm({ mode, userId, initialValues }: Props) {
  const router = useRouter();
  const [state, formAction] = useActionState(saveProfileAction, initialAuthActionState);

  // 初回オンボーディングは保存完了後にマイページへ遷移する。編集画面はその場に留まり成功メッセージを表示する。
  useEffect(() => {
    if (mode === "create" && state.success) {
      router.push("/stylist/mypage");
    }
  }, [mode, state.success, router]);

  return (
    <form action={formAction} className="space-y-8">
      <FormErrorBanner message={state.error} />
      {mode === "edit" && <FormSuccessBanner message={state.success} />}

      <PendingFieldset>
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
            <SelectField
              id="desiredSalaryRange"
              name="desiredSalaryRange"
              label="希望年収帯"
              placeholder="選択してください"
              defaultValue={initialValues.desiredSalaryRange}
              options={toOptions(SALARY_BAND_LABELS)}
              errors={state.fieldErrors?.desiredSalaryRange}
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
            <h2 className="eyebrow">個人情報（サロンへ自動公開されません）</h2>
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
            <h2 className="eyebrow">公開範囲・スカウト受信設定</h2>
            <SelectField
              id="visibility"
              name="visibility"
              label="プロフィールの公開範囲"
              defaultValue={initialValues.visibility}
              options={toOptions(VISIBILITY_LABELS)}
              errors={state.fieldErrors?.visibility}
            />
            <SelectField
              id="scoutEnabled"
              name="scoutEnabled"
              label="スカウト受信設定"
              defaultValue={String(initialValues.scoutEnabled)}
              options={[
                { value: "true", label: "スカウトを受け取る" },
                { value: "false", label: "スカウトを受け取らない" },
              ]}
              errors={state.fieldErrors?.scoutEnabled}
            />
          </section>
        </div>
      </PendingFieldset>

      <SubmitButton pendingText="保存中...">
        {mode === "create" ? "プロフィールを保存して始める" : "変更を保存"}
      </SubmitButton>
    </form>
  );
}
