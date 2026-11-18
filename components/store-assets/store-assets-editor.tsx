"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  addStoreLinkAction,
  addStorePhotoAction,
  deleteStoreLinkAction,
  deleteStorePhotoAction,
  replaceStorePhotoAction,
  setStoreLogoAction,
} from "@/lib/store-assets/actions";
import {
  STORE_ASSET_BUCKET,
  STORE_ASSET_CACHE_CONTROL,
  STORE_ASSET_MAX_BYTES,
  STORE_ASSET_MIME_TYPES,
  STORE_LINK_MAX,
  STORE_PHOTO_FOLDER,
  STORE_PHOTO_FRAME_CLASS,
  STORE_PHOTO_GRID_CLASS,
  STORE_PHOTO_IMAGE_CLASS,
  STORE_PHOTO_MAX,
} from "@/lib/store-assets/constants";
import type { StoreAssetLink, StoreAssetPhoto, StoreAssetsData } from "@/lib/store-assets/parse";
import { SALON_LINK_TYPE_LABELS } from "@/lib/validation/salon-links";

type Props = { storeId: string; storeName: string; initial: StoreAssetsData };

function extensionOf(type: string) {
  return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
}
function checkFile(file: File): string | null {
  if (!(STORE_ASSET_MIME_TYPES as readonly string[]).includes(file.type)) return "JPEG・PNG・WebP形式の画像を選択してください。";
  if (file.size > STORE_ASSET_MAX_BYTES) return "5MB以下の画像を選択してください。";
  return null;
}

/**
 * 店舗別のロゴ・写真・リンクの編集（書き込み権限者用。閲覧のみの担当者には表示しない。最終防衛はDB）。
 * この店舗（storeId）の分だけを保存する。ほかの店舗・アカウント共通のデータには触れない。
 * 写真・リンクは操作した時点で保存される。ロゴは選択した時点で保存される。
 */
export function StoreAssetsEditor({ storeId, storeName, initial }: Props) {
  const [logoPath, setLogoPath] = useState(initial.logoPath);
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [photos, setPhotos] = useState<StoreAssetPhoto[]>(initial.photos);
  const [links, setLinks] = useState<StoreAssetLink[]>(initial.links);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(path: string, file: File): Promise<boolean> {
    const { error: upErr } = await createClient()
      .storage.from(STORE_ASSET_BUCKET)
      .upload(path, file, { upsert: false, cacheControl: STORE_ASSET_CACHE_CONTROL, contentType: file.type });
    if (upErr) {
      setError("アップロードに失敗しました。権限がないか、通信に失敗しました。もう一度お試しください。");
      return false;
    }
    return true;
  }

  async function onLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    const problem = checkFile(file);
    if (problem) return setError(problem);
    setBusy("logo");
    const path = `${storeId}/logo/${crypto.randomUUID()}.${extensionOf(file.type)}`;
    if (await upload(path, file)) {
      const r = await setStoreLogoAction(storeId, path);
      if (r.success) { setLogoPath(r.logoPath); setLogoUrl(r.logoUrl); } else setError(r.error);
    }
    setBusy(null);
  }
  async function onLogoRemove() {
    setError(null); setBusy("logo");
    const r = await setStoreLogoAction(storeId, null);
    if (r.success) { setLogoPath(null); setLogoUrl(null); } else setError(r.error);
    setBusy(null);
  }
  async function onPhotoAdd(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (photos.length >= STORE_PHOTO_MAX) return setError(`店舗の写真は最大${STORE_PHOTO_MAX}枚までです。追加するには、写真を削除してください。`); // アップロードする前に止める（孤児画像を作らない）
    const problem = checkFile(file);
    if (problem) return setError(problem);
    setBusy("photo-add");
    const path = `${storeId}/${STORE_PHOTO_FOLDER}/${crypto.randomUUID()}.${extensionOf(file.type)}`;
    if (await upload(path, file)) {
      const r = await addStorePhotoAction(storeId, path);
      if (r.success) setPhotos((prev) => [...prev, r.photo]); else setError(r.error);
    }
    setBusy(null);
  }
  async function onPhotoReplace(photo: StoreAssetPhoto, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    const problem = checkFile(file);
    if (problem) return setError(problem);
    setBusy(`replace-${photo.id}`);
    const path = `${storeId}/${STORE_PHOTO_FOLDER}/${crypto.randomUUID()}.${extensionOf(file.type)}`;
    if (await upload(path, file)) {
      const r = await replaceStorePhotoAction(storeId, photo.id, path);
      if (r.success) setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, category: "photo", storagePath: r.storagePath, url: r.url } : p))); else setError(r.error);
    }
    setBusy(null);
  }
  async function onPhotoDelete(photo: StoreAssetPhoto) {
    setError(null); setBusy(`del-${photo.id}`);
    const r = await deleteStorePhotoAction(photo.id);
    if (r.success) setPhotos((prev) => prev.filter((p) => p.id !== photo.id)); else setError(r.error);
    setBusy(null);
  }
  async function onLinkAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null); setBusy("link");
    const r = await addStoreLinkAction(storeId, { linkType: String(fd.get("linkType") ?? "website"), label: String(fd.get("label") ?? ""), url: String(fd.get("url") ?? "") });
    if (r.success) { setLinks((prev) => [...prev, r.link].sort((a, b) => a.sortOrder - b.sortOrder)); form.reset(); } else setError(r.error);
    setBusy(null);
  }
  async function onLinkDelete(link: StoreAssetLink) {
    setError(null); setBusy(`del-${link.id}`);
    const r = await deleteStoreLinkAction(link.id);
    if (r.success) setLinks((prev) => prev.filter((l) => l.id !== link.id)); else setError(r.error);
    setBusy(null);
  }

  const photoFull = photos.length >= STORE_PHOTO_MAX;
  const photoButton = "inline-flex min-h-[36px] items-center justify-center rounded-full bg-ink/80 px-3.5 text-[12px] font-semibold text-surface";

  return (
    <div className="space-y-8">
      <p className="rounded-xl border border-line bg-surface2 px-4 py-3 text-[12.5px] leading-relaxed text-sub">
        ここで登録する内容は「{storeName}」だけのものです。ほかの店舗には表示されません。公開中の店舗では、美容師向けの店舗画面に表示されます（保存後は「プレビュー」で確認できます）。画像を差し替えた・削除した場合、発行済みの画像URLは最大5分ほど表示できることがあります。
      </p>
      {error && <p role="alert" className="rounded-xl border border-line bg-surface2 px-4 py-3 text-[12.5px] text-[#8A2E2E]">{error}</p>}

      <section className="space-y-3">
        <h3 className="eyebrow">店舗ロゴ</h3>
        <p className="text-[12px] text-sub">店名の左に小さく表示されます。写真の一覧には含まれません。</p>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface2 text-[10px] text-sub">
            {/* eslint-disable-next-line @next/next/no-img-element -- 署名付きURLをそのまま表示するため */}
            {logoUrl ? <img src={logoUrl} alt="店舗ロゴ" className="h-full w-full object-contain" /> : "未登録"}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="truncate text-[13px] font-medium text-charcoal">{storeName}</span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <label className={`inline-flex min-h-[36px] items-center justify-center rounded-full border border-ink px-4 text-[12.5px] font-semibold text-ink ${busy ? "opacity-60" : "cursor-pointer"}`}>
                {busy === "logo" ? "保存中..." : logoPath ? "ロゴを差し替える" : "ロゴを選ぶ"}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={busy !== null} onChange={onLogo} />
              </label>
              {logoPath && <button type="button" onClick={onLogoRemove} disabled={busy !== null} className="text-[12px] text-sub underline disabled:opacity-60">ロゴを削除</button>}
            </div>
          </div>
        </div>
        <p className="text-[11.5px] text-sub">JPEG・PNG・WebP / 5MB以下</p>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h3 className="eyebrow">店舗の写真</h3>
          <span className="text-[12.5px] font-semibold text-charcoal" aria-live="polite">現在 {photos.length}／{STORE_PHOTO_MAX}枚</span>
        </div>
        <p className="text-[12px] leading-relaxed text-sub">最大{STORE_PHOTO_MAX}枚まで登録できます。登録した順に表示されます。差し替え・削除は各写真のボタンから行えます。</p>
        <ul className={STORE_PHOTO_GRID_CLASS}>
          {photos.map((p) => (
            <li key={p.id} className={STORE_PHOTO_FRAME_CLASS}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 署名付きURLをそのまま表示するため */}
              {p.url ? <img src={p.url} alt="店舗の写真" className={STORE_PHOTO_IMAGE_CLASS} /> : <span className="flex h-full w-full items-center justify-center text-[12px] text-sub">画像を表示できません</span>}
              <div className="absolute inset-x-2 bottom-2 flex items-center justify-end gap-2">
                <label className={`${photoButton} ${busy ? "opacity-60" : "cursor-pointer"}`}>
                  {busy === `replace-${p.id}` ? "差し替え中..." : "差し替え"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={busy !== null} onChange={(e) => onPhotoReplace(p, e)} />
                </label>
                <button type="button" onClick={() => onPhotoDelete(p)} disabled={busy !== null} className={`${photoButton} disabled:opacity-60`}>
                  {busy === `del-${p.id}` ? "削除中..." : "削除"}
                </button>
              </div>
            </li>
          ))}
          {!photoFull && (
            <li>
              <label className={`${STORE_PHOTO_FRAME_CLASS} flex items-center justify-center border-dashed text-center text-[13px] text-sub ${busy ? "opacity-60" : "cursor-pointer"}`}>
                {busy === "photo-add" ? "アップロード中..." : "＋ 写真を追加"}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={busy !== null} onChange={onPhotoAdd} />
              </label>
            </li>
          )}
        </ul>
        {photoFull && <p className="text-[12px] leading-relaxed text-sub">上限の{STORE_PHOTO_MAX}枚に達しています。新しい写真を追加するには、不要な写真を削除してください（写真の入れ替えは「差し替え」で行えます）。</p>}
        <p className="text-[11.5px] text-sub">JPEG・PNG・WebP / 1枚5MB以下</p>
      </section>

      <section className="space-y-3">
        <h3 className="eyebrow">外部リンク（最大{STORE_LINK_MAX}件）</h3>
        {links.length > 0 && (
          <ul className="space-y-2">
            {links.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate"><span className="font-semibold text-ink">{l.label || SALON_LINK_TYPE_LABELS[l.linkType]}</span> <span className="text-sub">{l.url}</span></span>
                <button type="button" onClick={() => onLinkDelete(l)} disabled={busy !== null} className="shrink-0 text-[12px] text-sub underline disabled:opacity-60">{busy === `del-${l.id}` ? "…" : "削除"}</button>
              </li>
            ))}
          </ul>
        )}
        {links.length < STORE_LINK_MAX && (
          <form onSubmit={onLinkAdd} className="space-y-2">
            <select name="linkType" defaultValue="website" className="min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 text-[13px]">
              {Object.entries(SALON_LINK_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input name="label" maxLength={40} placeholder="表示名（任意・40文字まで）" className="min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 text-[13px]" />
            <input name="url" type="url" required placeholder="https://" className="min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 text-[13px]" />
            <button type="submit" disabled={busy !== null} className="min-h-[44px] w-full rounded-full border border-ink px-4 text-[13px] font-semibold text-ink disabled:opacity-60">{busy === "link" ? "追加中..." : "リンクを追加"}</button>
          </form>
        )}
      </section>
    </div>
  );
}
