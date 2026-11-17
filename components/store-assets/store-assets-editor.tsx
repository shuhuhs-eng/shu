"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  addStoreLinkAction,
  addStorePhotoAction,
  deleteStoreLinkAction,
  deleteStorePhotoAction,
  setStoreLogoAction,
} from "@/lib/store-assets/actions";
import {
  STORE_ASSET_BUCKET,
  STORE_ASSET_CACHE_CONTROL,
  STORE_ASSET_MAX_BYTES,
  STORE_ASSET_MIME_TYPES,
  STORE_LINK_MAX,
  STORE_PHOTO_MAX,
} from "@/lib/store-assets/constants";
import type { StoreAssetLink, StoreAssetPhoto, StoreAssetsData } from "@/lib/store-assets/parse";
import { SALON_LINK_TYPE_LABELS } from "@/lib/validation/salon-links";

type Props = { storeId: string; storeName: string; initial: StoreAssetsData };
type Category = "interior" | "atmosphere";

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
  async function onPhoto(category: Category, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    const problem = checkFile(file);
    if (problem) return setError(problem);
    setBusy(`photo-${category}`);
    const path = `${storeId}/${category}/${crypto.randomUUID()}.${extensionOf(file.type)}`;
    if (await upload(path, file)) {
      const r = await addStorePhotoAction(storeId, category, path);
      if (r.success) setPhotos((prev) => [...prev, r.photo].sort((a, b) => a.sortOrder - b.sortOrder)); else setError(r.error);
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

  const photoBlock = (category: Category, label: string) => {
    const list = photos.filter((p) => p.category === category);
    const full = list.length >= STORE_PHOTO_MAX;
    return (
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-charcoal">{label}</span>
          <span className="text-[12px] text-sub">{list.length} / {STORE_PHOTO_MAX}枚</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {list.map((p) => (
            <div key={p.id} className="relative aspect-square overflow-hidden rounded-xl border border-line bg-surface2">
              {/* eslint-disable-next-line @next/next/no-img-element -- 署名付きURLをそのまま表示するため */}
              {p.url && <img src={p.url} alt="" className="h-full w-full object-cover" />}
              <button type="button" onClick={() => onPhotoDelete(p)} disabled={busy !== null} aria-label="削除"
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-ink/70 text-[12px] text-surface disabled:opacity-60">
                {busy === `del-${p.id}` ? "…" : "×"}
              </button>
            </div>
          ))}
          {!full && (
            <label className={`flex aspect-square items-center justify-center rounded-xl border border-dashed border-line bg-surface2 text-center text-[12px] text-sub ${busy ? "opacity-60" : "cursor-pointer"}`}>
              {busy === `photo-${category}` ? "アップロード中..." : "＋ 画像を追加"}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={busy !== null} onChange={(e) => onPhoto(category, e)} />
            </label>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <p className="rounded-xl border border-line bg-surface2 px-4 py-3 text-[12.5px] leading-relaxed text-sub">
        ここで登録する内容は「{storeName}」だけのものです。ほかの店舗には表示されません。公開中の店舗では、美容師向けの店舗画面に表示されます（保存後は「プレビュー」で確認できます）。画像を差し替えた・削除した場合、発行済みの画像URLは最大5分ほど表示できることがあります。
      </p>
      {error && <p role="alert" className="rounded-xl border border-line bg-surface2 px-4 py-3 text-[12.5px] text-[#8A2E2E]">{error}</p>}

      <section className="space-y-3">
        <h3 className="eyebrow">店舗ロゴ</h3>
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-line bg-surface2 text-[11px] text-sub">
            {/* eslint-disable-next-line @next/next/no-img-element -- 署名付きURLをそのまま表示するため */}
            {logoUrl ? <img src={logoUrl} alt="店舗ロゴ" className="h-full w-full object-contain" /> : "未登録"}
          </div>
          <div className="flex flex-col gap-2">
            <label className={`inline-flex min-h-[40px] items-center justify-center rounded-full border border-ink px-4 text-[12.5px] font-semibold text-ink ${busy ? "opacity-60" : "cursor-pointer"}`}>
              {busy === "logo" ? "保存中..." : logoPath ? "ロゴを差し替える" : "ロゴを選ぶ"}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={busy !== null} onChange={onLogo} />
            </label>
            {logoPath && <button type="button" onClick={onLogoRemove} disabled={busy !== null} className="text-[12px] text-sub underline disabled:opacity-60">ロゴを削除</button>}
          </div>
        </div>
        <p className="text-[11.5px] text-sub">JPEG・PNG・WebP / 5MB以下</p>
      </section>

      <section className="space-y-5">
        <h3 className="eyebrow">店舗の写真</h3>
        {photoBlock("interior", "内装写真")}
        {photoBlock("atmosphere", "スタッフ・サロンの雰囲気")}
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
