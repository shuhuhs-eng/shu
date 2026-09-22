"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { saveSalonProfileAction } from "@/lib/salon/actions";
import { initialAuthActionState } from "@/lib/auth/types";
import { SubmitButton } from "@/components/auth/submit-button";
import { PendingFieldset } from "@/components/auth/pending-fieldset";
import { FormErrorBanner, FormSuccessBanner } from "@/components/auth/form-messages";
import { TextField } from "@/components/auth/text-field";
import { SelectField } from "@/components/profile/select-field";
import { CheckboxGroupField } from "@/components/profile/checkbox-group-field";
import { TextareaField } from "@/components/profile/textarea-field";
import { AvatarUploader } from "@/components/profile/avatar-uploader";
import { SalonPhotoUploader } from "@/components/salon-profile/salon-photo-uploader";
import { SalonLinksEditor } from "@/components/salon-profile/salon-links-editor";
import type { SalonPhotoWithUrl } from "@/lib/salon-photos/actions";
import type { SalonLinkRow } from "@/lib/salon-links/actions";
import { PREFECTURES, SPECIALTY_OPTIONS, VISIBILITY_LABELS } from "@/lib/validation/profile-options";
import type { ProfileVisibility } from "@/types/database";

export type SalonProfileFormInitialValues = {
  salonName: string;
  prefecture: string;
  city: string;
  streetAddress: string;
  cultureDescription: string;
  employeeSizeCode: string;
  targetSpecialties: string[];
  instagramHandle: string;
  bio: string;
  avatarPath: string | null;
  avatarSignedUrl: string | null;
  hotpepperUrl: string;
  interiorPhotos: SalonPhotoWithUrl[];
  atmospherePhotos: SalonPhotoWithUrl[];
  salonLinks: SalonLinkRow[];
  visibility: ProfileVisibility;
};

type Props = {
  mode: "create" | "edit";
  userId: string;
  initialValues: SalonProfileFormInitialValues;
  employeeSizeOptions: Array<{ code: string; label: string }>;
};

const toOptions = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

/**
 * サロンプロフィールフォーム。components/profile/profile-form.tsx（stylist側）と対称構造。
 * 個人情報セクション（stylist_privateに相当するもの）・スカウト受信設定
 * （user_settingsに相当するもの）は無い。得意技術のかわりに「採用したい得意技術」を使う。
 * 従業員数はenumではなくemployee_size_masterから取得した選択肢を使う点のみ、
 * stylist側と構造が異なる（マスタテーブル参照のため）。
 */
export function SalonProfileForm({ mode, userId, initialValues, employeeSizeOptions }: Props) {
  const router = useRouter();
  const [state, formAction] = useActionState(saveSalonProfileAction, initialAuthActionState);

  // 初回オンボーディング（複数role対応での2つ目のroleとしての登録も含む）は
  // 保存完了後、サロンマイページへ直接遷移する。編集画面はその場に留まり
  // 成功メッセージを表示する。
  useEffect(() => {
    if (mode === "create" && state.success) {
      router.push("/salon/mypage");
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
              label="サロンロゴ（任意）"
              description="サロンのロゴ画像を登録できます（JPEG・PNG・WebP / 5MB以下）"
            />
            <TextField
              id="salonName"
              name="salonName"
              label="サロン名（屋号）"
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
              label="サロンのカルチャー・文化（任意）"
              defaultValue={initialValues.cultureDescription}
              maxLength={2000}
              errors={state.fieldErrors?.cultureDescription}
            />
            {/* ★Instagram / HOTPEPPER Beauty の二重入力を解消するため、
                これらの専用入力欄はフォーム上に表示しない（編集場所は
                下部の「外部リンク」セクション＝SalonLinksEditorの1箇所に
                統一する）。ただし既存の salon_profiles.instagram_handle /
                hotpepper_url 列は後方互換のため削除していないため、
                saveSalonProfileAction（既存ロジック無変更）が毎回この
                2フィールドを含めて保存する仕様上、値を送らないとnullで
                上書きされてしまう。既存値をそのままhidden inputとして
                再送信することで、値を一切変更せず維持する
                （0015のbackfillで既にsalon_linksへコピー済みのため、
                今後これらの列が新たに増えることは無い＝実質的に凍結される）。 */}
            <input type="hidden" name="instagramHandle" value={initialValues.instagramHandle} />
            <input type="hidden" name="hotpepperUrl" value={initialValues.hotpepperUrl} />
            <TextareaField
              id="bio"
              name="bio"
              label="サロン紹介（任意）"
              defaultValue={initialValues.bio}
              maxLength={1000}
              errors={state.fieldErrors?.bio}
            />
          </section>

          <section className="space-y-5">
            <h2 className="eyebrow">サロン写真</h2>
            <SalonPhotoUploader
              userId={userId}
              category="interior"
              label="内装写真"
              initialPhotos={initialValues.interiorPhotos}
            />
            <SalonPhotoUploader
              userId={userId}
              category="atmosphere"
              label="スタッフ・サロンの雰囲気"
              initialPhotos={initialValues.atmospherePhotos}
            />
          </section>

          <section className="space-y-4">
            <h2 className="eyebrow">外部リンク</h2>
            <p className="text-[12.5px] leading-relaxed text-sub">
              HOTPEPPER Beauty・公式ホームページ・求人ページなど、サロンの外部リンクを最大5件登録できます。
            </p>
            <SalonLinksEditor initialLinks={initialValues.salonLinks} />
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

      <SubmitButton pendingText="保存中...">
        {mode === "create" ? "プロフィールを保存して始める" : "変更を保存"}
      </SubmitButton>

      {mode === "edit" && (
        <Link href="/salon/mypage" className="block text-center text-[13px] text-sub underline">
          マイページに戻る
        </Link>
      )}
    </form>
  );
}
