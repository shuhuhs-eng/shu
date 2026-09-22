"use client";

import { useState, type ChangeEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  addSalonPhotoAction,
  deleteSalonPhotoAction,
  type SalonPhotoWithUrl,
} from "@/lib/salon-photos/actions";
import type { SalonPhotoCategory } from "@/types/database";

type Props = {
  userId: string;
  category: SalonPhotoCategory;
  label: string;
  initialPhotos: SalonPhotoWithUrl[];
};

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB（Storageバケット側のfile_size_limitでも強制）
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"]; // バケット側のallowed_mime_typesと一致させる
const MAX_PHOTOS = 3;

/**
 * サロン画像（内装・雰囲気）の複数枚アップロードUI。
 *
 * ★既存の components/profile/avatar-uploader.tsx は変更していない
 * （固定1パス・フォーム送信時に一括保存という別の設計のため、複数枚・
 * 即時DB登録が必要な今回の用途には流用せず、専用の新規コンポーネントとした）。
 *
 * アップロード即時にStorageへ保存し、成功したらその場でaddSalonPhotoAction
 * （0014のadd_salon_photo RPCの薄いラッパー）を呼んでDB登録する（フォームの
 * 送信ボタンを待たない）。DB登録が失敗した場合、addSalonPhotoAction内部で
 * アップロード済みのStorageオブジェクトを自動的に削除し、孤児ファイルを
 * 残さない。
 *
 * storage_pathは必ず {userId}/{category}/{filename} 形式にする
 * （0014のvalidate_and_normalize_salon_photo_path()が要求する形式）。
 */
export function SalonPhotoUploader({ userId, category, label, initialPhotos }: Props) {
  const [photos, setPhotos] = useState<SalonPhotoWithUrl[]>(initialPhotos);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isFull = photos.length >= MAX_PHOTOS;

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同じファイルを連続選択しても再度onChangeが発火するように
    if (!file) return;

    setError(null);

    if (isFull) {
      setError(`${label}は既に${MAX_PHOTOS}枚登録されています。`);
      return;
    }
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setError("JPEG・PNG・WebP形式の画像を選択してください。");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError("5MB以下の画像を選択してください。");
      return;
    }

    setUploading(true);

    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const filename = `${crypto.randomUUID()}.${extension}`;
    const storagePath = `${userId}/${category}/${filename}`;

    const supabase = createClient();
    const { error: uploadErr } = await supabase.storage.from("salon-photos").upload(storagePath, file, {
      upsert: false,
      cacheControl: "3600",
      contentType: file.type,
    });

    if (uploadErr) {
      setError("アップロードに失敗しました。もう一度お試しください。");
      setUploading(false);
      return;
    }

    const result = await addSalonPhotoAction(category, storagePath);
    setUploading(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    setPhotos((prev) => [...prev, result.photo].sort((a, b) => a.sortOrder - b.sortOrder));
  }

  async function handleDelete(photo: SalonPhotoWithUrl) {
    setError(null);
    setDeletingId(photo.id);

    const result = await deleteSalonPhotoAction(photo.id, photo.storagePath);
    setDeletingId(null);

    if (!result.success) {
      setError(result.error);
      // ★DB削除側が失敗した場合等、実際の状態が不確かになりうるため、
      // 呼び出し元の指示どおり最新の状態をサーバーから再取得する。
      window.location.reload();
      return;
    }

    setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-charcoal">{label}</span>
        <span className="text-[12px] text-sub">
          {photos.length} / {MAX_PHOTOS}枚
        </span>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        {photos.map((photo) => (
          <PhotoTile
            key={photo.id}
            photo={photo}
            deleting={deletingId === photo.id}
            onDelete={() => handleDelete(photo)}
          />
        ))}

        {!isFull && (
          <label
            className={`flex aspect-square items-center justify-center rounded-xl border border-dashed border-line bg-surface2 text-center text-[12px] text-sub ${
              uploading ? "opacity-60" : "cursor-pointer"
            }`}
          >
            {uploading ? "アップロード中..." : "＋ 画像を追加"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              disabled={uploading}
              className="hidden"
            />
          </label>
        )}
      </div>

      <p className="mt-1.5 text-[11.5px] text-sub">JPEG・PNG・WebP / 5MB以下 / 最大{MAX_PHOTOS}枚</p>
      {error && <p className="mt-1.5 text-[12.5px] text-[#8A2E2E]">{error}</p>}
    </div>
  );
}

/** サムネイル1枚分。削除ボタン付き。 */
function PhotoTile({
  photo,
  deleting,
  onDelete,
}: {
  photo: SalonPhotoWithUrl;
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="group relative aspect-square overflow-hidden rounded-xl border border-line bg-surface2">
      {photo.signedUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- 署名付きURLをそのまま表示するため
        <img src={photo.signedUrl} alt="" className="h-full w-full object-cover" />
      )}
      <button
        type="button"
        onClick={onDelete}
        disabled={deleting}
        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink/70 text-[12px] text-surface disabled:opacity-60"
        aria-label="削除"
      >
        {deleting ? "…" : "×"}
      </button>
    </div>
  );
}
