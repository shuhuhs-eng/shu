"use client";

import { useState, type ChangeEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { FieldError } from "@/components/auth/form-messages";

type Props = {
  userId: string;
  initialPath: string | null;
  initialSignedUrl: string | null;
  errors?: string[];
  /** 見出しラベル。省略時は既存の「プロフィール画像」のまま（美容師側の既存挙動を変えない）。 */
  label?: string;
  /** 補足説明文。省略時は既存の「JPEG・PNG・WebP / 5MB以下・任意項目」のまま。 */
  description?: string;
};

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB（Storageバケット側のfile_size_limitでも強制）
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"]; // バケット側のallowed_mime_typesと一致させる

/**
 * プロフィール画像のアップロード。stylist/salon両方のプロフィールフォーム
 * （components/profile/profile-form.tsx・components/salon-profile/salon-profile-form.tsx）
 * から共用される、role非依存の汎用コンポーネント。
 *
 * ・保存パスはユーザーごとに固定（"{userId}/avatar.webp"）。UUID等は使わず、
 *   常に upsert:true で同じオブジェクトを上書きする。これにより、選び直しや
 *   再アップロードによって別オブジェクトが増えることがなく、孤立ファイルの
 *   蓄積が構造的に発生しない。
 * ・avatarsバケットは非公開のため、アップロード後は公開URLではなく
 *   署名付きURLをその場で発行してプレビューに使う。
 * ・DBへ保存するのは avatarPath（固定パス）のみ。hidden inputに入れて
 *   フォーム送信に含める（実際の所有権検証は save_stylist_profile() /
 *   save_salon_profile() 双方が共有する validate_and_normalize_avatar_path()
 *   RPC側で行う）。
 */
export function AvatarUploader({
  userId,
  initialPath,
  initialSignedUrl,
  errors,
  label = "プロフィール画像",
  description = "JPEG・PNG・WebP / 5MB以下・任意項目",
}: Props) {
  const avatarPath = `${userId}/avatar.webp`;
  const [path, setPath] = useState<string | null>(initialPath);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialSignedUrl);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setUploadError("JPEG・PNG・WebP形式の画像を選択してください。");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setUploadError("5MB以下の画像を選択してください。");
      return;
    }

    setUploading(true);
    setUploadError(null);

    const supabase = createClient();

    // 固定パスへ常に upsert（既存の同名オブジェクトを置き換える）。
    const { error: uploadErr } = await supabase.storage.from("avatars").upload(avatarPath, file, {
      upsert: true,
      cacheControl: "3600",
      contentType: file.type,
    });

    if (uploadErr) {
      setUploadError("アップロードに失敗しました。もう一度お試しください。");
      setUploading(false);
      return;
    }

    const { data: signedData, error: signErr } = await supabase.storage
      .from("avatars")
      .createSignedUrl(avatarPath, 60 * 60);

    setPath(avatarPath);
    setPreviewUrl(signErr ? null : (signedData?.signedUrl ?? null));
    setUploading(false);
  }

  return (
    <div>
      <span className="mb-1.5 block text-[13px] font-medium text-charcoal">{label}</span>
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-line bg-surface2">
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- 署名付きURLをそのまま表示するため
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="flex-1">
          <label className="inline-flex cursor-pointer items-center rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-medium text-charcoal">
            {uploading ? "アップロード中..." : "画像を選択"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              disabled={uploading}
              className="hidden"
            />
          </label>
          <p className="mt-1 text-[12px] text-sub">{description}</p>
        </div>
      </div>
      <input type="hidden" name="avatarPath" value={path ?? ""} />
      {uploadError && <p className="mt-1 text-[12.5px] text-[#8A2E2E]">{uploadError}</p>}
      <FieldError messages={errors} />
    </div>
  );
}
