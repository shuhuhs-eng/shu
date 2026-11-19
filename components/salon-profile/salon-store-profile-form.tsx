"use client";

import Link from "next/link";
import { startTransition, useActionState, useRef, useState, useEffect, type FormEvent } from "react";
import { saveSalonStoreProfileAction } from "@/lib/salon/store-actions";
import { initialAuthActionState } from "@/lib/auth/types";
import { SalonVisibilityField } from "@/components/salon-profile/salon-visibility-field";
import { FormErrorBanner, FormSuccessBanner } from "@/components/auth/form-messages";
import { TextField } from "@/components/auth/text-field";
import { SelectField } from "@/components/profile/select-field";
import { CheckboxGroupField } from "@/components/profile/checkbox-group-field";
import { TextareaField } from "@/components/profile/textarea-field";
import { PREFECTURES, SPECIALTY_OPTIONS } from "@/lib/validation/profile-options";
import type { SalonVisibilityChoice } from "@/lib/salon/store-visibility";
import { StoreIntroField } from "@/components/salon-profile/store-intro-field";
import { STORE_INTRO_MAX } from "@/lib/validation/salon-store-profile";

export type SalonStoreProfileFormInitialValues = {
  salonName: string;
  prefecture: string;
  city: string;
  streetAddress: string;
  /** 以前の「店舗のカルチャー・文化」欄の文章（読み取り専用。削除しない。公開表示は introUnified で切り替わる） */
  legacyCulture: string;
  /** 保存時に画面が読み込んでいた店舗紹介の版。他の画面での更新を上書きしないための照合に使う（未保存の店舗は null） */
  introRevision: number | null;
  /** 「統合済み」（旧文化欄の公開表示を止める印）か */
  introUnified: boolean;
  employeeSizeCode: string;
  targetSpecialties: string[];
  bio: string;
  hotpepperUrl: string;
  visibility: SalonVisibilityChoice;
};

type Props = {
  storeId: string;
  initialValues: SalonStoreProfileFormInitialValues;
  employeeSizeOptions: Array<{ code: string; label: string }>;
};

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
  const [state, formAction, isPending] = useActionState(
    saveSalonStoreProfileAction.bind(null, storeId),
    initialAuthActionState,
  );
  const submittingRef = useRef(false);
  // 成功メッセージを消した（再編集を始めた）時点の state。同じ state の成功メッセージは再表示しない。
  const [dismissedFor, setDismissedFor] = useState<unknown>(null);

  // 送信が終わったら、二重送信のガードを外す。
  useEffect(() => {
    if (!isPending) submittingRef.current = false;
  }, [isPending, state]);

  // <form action> ではなく onSubmit から直接送る。<form action> は完了後に入力欄を初期値へ戻す（React 19）ため、
  // 保存に失敗したときに入力内容が消え、成功したときも画面の値が保存した値と食い違うことがある。
  // ここでは入力欄に触れない。保存に成功すると、再取得した保存済みの値でフィールドを作り直す（下の key）。
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isPending || submittingRef.current) return; // 二重送信の防止
    submittingRef.current = true;
    const formData = new FormData(e.currentTarget);
    startTransition(() => {
      formAction(formData);
    });
  }
  const dismissSuccess = () => {
    if (state.success) setDismissedFor(state);
  };
  // 保存中は成功も失敗も出さない。成功は、実際の保存成功のあとだけ。
  const successMessage = !isPending && state.success && dismissedFor !== state ? state.success : undefined;
  const errorMessage = isPending ? undefined : state.error;
  const fieldsKey = JSON.stringify(initialValues);
  const [overLimit, setOverLimit] = useState(false);

  return (
    <form onSubmit={handleSubmit} onChange={dismissSuccess} onInput={dismissSuccess} className="space-y-8">
      <FormErrorBanner message={errorMessage} />
      <FormSuccessBanner message={successMessage} />

      <fieldset disabled={isPending} key={fieldsKey} className="contents m-0 border-0 p-0">
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
            <TextField
              id="hotpepperUrl"
              name="hotpepperUrl"
              label="HOTPEPPER Beauty URL（任意）"
              required={false}
              defaultValue={initialValues.hotpepperUrl}
              errors={state.fieldErrors?.hotpepperUrl}
            />
            <StoreIntroField
              defaultBio={initialValues.bio}
              legacyCulture={initialValues.legacyCulture}
              unified={initialValues.introUnified}
              max={STORE_INTRO_MAX}
              errors={state.fieldErrors?.bio}
              onOverChange={setOverLimit}
            />
            {initialValues.introRevision != null && <input type="hidden" name="expectedRevision" value={initialValues.introRevision} />}
          </section>

          <section className="space-y-4">
            <h2 className="eyebrow">公開範囲</h2>
            <SalonVisibilityField defaultValue={initialValues.visibility} errors={state.fieldErrors?.visibility} />
          </section>
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={isPending || overLimit}
        aria-busy={isPending}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface transition-opacity disabled:opacity-60"
      >
        {isPending ? "保存中..." : "変更を保存"}
      </button>

      <Link href={`/salon/stores/${storeId}`} className="block text-center text-[13px] text-sub underline">
        店舗ワークスペースへ戻る
      </Link>
    </form>
  );
}
