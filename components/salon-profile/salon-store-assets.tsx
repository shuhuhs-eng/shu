"use client";

import { useActionState } from "react";
import { saveSalonLogoAction } from "@/lib/salon/actions";
import { initialAuthActionState } from "@/lib/auth/types";
import { SubmitButton } from "@/components/auth/submit-button";
import { PendingFieldset } from "@/components/auth/pending-fieldset";
import { FormErrorBanner, FormSuccessBanner } from "@/components/auth/form-messages";
import { AvatarUploader } from "@/components/profile/avatar-uploader";
import { SalonPhotoUploader } from "@/components/salon-profile/salon-photo-uploader";
import { SalonLinksEditor } from "@/components/salon-profile/salon-links-editor";
import type { SalonPhotoWithUrl } from "@/lib/salon-photos/actions";
import type { SalonLinkRow } from "@/lib/salon-links/actions";

export type SalonStoreAssetsInitialValues = {
  avatarPath: string | null;
  avatarSignedUrl: string | null;
  interiorPhotos: SalonPhotoWithUrl[];
  atmospherePhotos: SalonPhotoWithUrl[];
  salonLinks: SalonLinkRow[];
};

type Props = {
  userId: string;
  initialValues: SalonStoreAssetsInitialValues;
};

/**
 * 店舗プロフィール編集画面に統合した「ロゴ・写真・リンク」セクション。
 *
 * 旧「ロゴ・写真・リンクを編集」（/salon/profile）の中身を、保存・アップロード・削除の
 * 既存の仕組み（update_salon_logo / add_salon_photo / salon_links）のまま移したもの。
 * 保存先はこれまでと同じ（アカウント単位）で、データの移行・再入力は不要。
 * ロゴだけが「保存」ボタンを持ち、写真とリンクは操作した時点で保存される。
 */
export function SalonStoreAssets({ userId, initialValues }: Props) {
  const [state, formAction] = useActionState(saveSalonLogoAction, initialAuthActionState);

  return (
    <div className="space-y-8">
      <p className="rounded-xl border border-line bg-surface2 px-4 py-3 text-[12.5px] leading-relaxed text-sub">
        ロゴ・写真・外部リンクは、これまでどおりアカウントで共通です（店舗ごとに分かれてはいません）。複数の店舗がある場合も、どの店舗の編集画面からでも同じ内容を編集します。
      </p>

      <form action={formAction} className="space-y-4">
        <FormErrorBanner message={state.error} />
        <FormSuccessBanner message={state.success} />
        <PendingFieldset>
          <h2 className="eyebrow">サロンロゴ</h2>
          <AvatarUploader
            userId={userId}
            initialPath={initialValues.avatarPath}
            initialSignedUrl={initialValues.avatarSignedUrl}
            errors={state.fieldErrors?.avatarPath}
            label="サロンロゴ（任意）"
            description="サロンのロゴ画像を登録できます（JPEG・PNG・WebP / 5MB以下）"
          />
        </PendingFieldset>
        <SubmitButton pendingText="保存中...">ロゴを保存</SubmitButton>
      </form>

      <section className="space-y-5">
        <h2 className="eyebrow">サロン写真</h2>
        <p className="rounded-xl border border-line bg-surface2 px-4 py-3 text-[12.5px] leading-relaxed text-sub">
          ここで登録した写真は、現時点では美容師向けの店舗画面には表示されません（店舗ごとの写真は今後の対応です）。追加・削除はその場で保存されます。
        </p>
        <SalonPhotoUploader userId={userId} category="interior" label="内装写真" initialPhotos={initialValues.interiorPhotos} />
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
          HOTPEPPER Beauty・公式ホームページ・求人ページなど、サロンの外部リンクを最大5件登録できます。追加・削除はその場で保存されます。
        </p>
        <SalonLinksEditor initialLinks={initialValues.salonLinks} />
      </section>
    </div>
  );
}
