"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveSalonStoreProfileAction } from "@/lib/salon/store-actions";
import { initialAuthActionState } from "@/lib/auth/types";
import { SubmitButton } from "@/components/auth/submit-button";
import { PendingFieldset } from "@/components/auth/pending-fieldset";
import { FormErrorBanner, FormSuccessBanner } from "@/components/auth/form-messages";
import { TextField } from "@/components/auth/text-field";
import { SelectField } from "@/components/profile/select-field";
import { CheckboxGroupField } from "@/components/profile/checkbox-group-field";
import { TextareaField } from "@/components/profile/textarea-field";
import { PREFECTURES, SPECIALTY_OPTIONS, VISIBILITY_LABELS } from "@/lib/validation/profile-options";
import type { ProfileVisibility } from "@/types/database";

export type SalonStoreProfileFormInitialValues = {
  salonName: string;
  prefecture: string;
  city: string;
  streetAddress: string;
  cultureDescription: string;
  employeeSizeCode: string;
  targetSpecialties: string[];
  bio: string;
  hotpepperUrl: string;
  visibility: ProfileVisibility;
};

type Props = {
  storeId: string;
  initialValues: SalonStoreProfileFormInitialValues;
  employeeSizeOptions: Array<{ code: string; label: string }>;
};

const toOptions = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

/**
 * 店舗単位プロフィールフォーム（法人・複数店舗対応 Phase 3B）。
 *
 * ★既存components/salon-profile/salon-profile-form.tsxとは意図的に分けた
 * 別コンポーネント（既存Formの変更・共通化は行っていない）。理由:
 * 既存Formはサロンロゴ(AvatarUploader)・サロン写真(SalonPhotoUploader)・
 * 外部リンク(SalonLinksEditor)を含み、いずれもuser_id(auth.uid())を直接の
 * 所有キーとする既存機能（0014/0015）と強く結合している。これらは
 * salon_store_profilesに対応する列を持たず、Phase 3Bの対象外のため、
 * 既存Formへstore_idを後付けして無理に共通化するのではなく、店舗編集に
 * 必要な項目のみを持つ専用フォームとして新設した。
 */
export function SalonStoreProfileForm({ storeId, initialValues, employeeSizeOptions }: Props) {
  const [state, formAction] = useActionState(
    saveSalonStoreProfileAction.bind(null, storeId),
    initialAuthActionState,
  );

  return (
    <form action={formAction} className="space-y-8">
      <FormErrorBanner message={state.error} />
      <FormSuccessBanner message={state.success} />

      <PendingFieldset>
        <div className="space-y-8">
          <section className="space-y-4">
            <h2 className="eyebrow">店舗プロフィール</h2>
            <TextField
              id="salonName"
              name="salonName"
              label="店舗名（屋号）"
              defaultValue={initialValues.salonName}
              errors={state.fieldErrors?.salonName}
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
              id="city"
              name="city"
              label="市区町村（任意）"
              required={false}
              defaultValue={initialValues.city}
              errors={state.fieldErrors?.city}
            />
            <TextField
              id="streetAddress"
              name="streetAddress"
              label="番地・建物名（任意）"
              required={false}
              defaultValue={initialValues.streetAddress}
              errors={state.fieldErrors?.streetAddress}
            />
            <SelectField
              id="employeeSizeCode"
              name="employeeSizeCode"
              label="従業員数"
              placeholder="選択してください"
              defaultValue={initialValues.employeeSizeCode}
              options={employeeSizeOptions.map((e) => ({ value: e.code, label: e.label }))}
              errors={state.fieldErrors?.employeeSizeCode}
            />
            <CheckboxGroupField
              name="targetSpecialties"
              label="採用したい得意技術"
              options={SPECIALTY_OPTIONS}
              defaultValues={initialValues.targetSpecialties}
              errors={state.fieldErrors?.targetSpecialties}
            />
            <TextareaField
              id="cultureDescription"
              name="cultureDescription"
              label="店舗のカルチャー・文化（任意）"
              defaultValue={initialValues.cultureDescription}
              maxLength={2000}
              errors={state.fieldErrors?.cultureDescription}
            />
            <TextField
              id="hotpepperUrl"
              name="hotpepperUrl"
              label="HOTPEPPER Beauty URL（任意）"
              required={false}
              defaultValue={initialValues.hotpepperUrl}
              errors={state.fieldErrors?.hotpepperUrl}
            />
            <TextareaField
              id="bio"
              name="bio"
              label="店舗紹介（任意）"
              defaultValue={initialValues.bio}
              maxLength={1000}
              errors={state.fieldErrors?.bio}
            />
          </section>

          <section className="space-y-4">
            <h2 className="eyebrow">公開範囲</h2>
            <SelectField
              id="visibility"
              name="visibility"
              label="プロフィールの公開範囲"
              defaultValue={initialValues.visibility}
              options={toOptions(VISIBILITY_LABELS)}
              errors={state.fieldErrors?.visibility}
            />
          </section>
        </div>
      </PendingFieldset>

      <SubmitButton pendingText="保存中...">変更を保存</SubmitButton>

      <Link href={`/salon/stores/${storeId}`} className="block text-center text-[13px] text-sub underline">
        店舗ワークスペースへ戻る
      </Link>
    </form>
  );
}
