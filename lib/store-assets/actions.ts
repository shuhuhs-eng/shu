"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { looseRpc } from "@/lib/diagnosis-limit/rpc";
import { logError } from "@/lib/security/log";
import { addSalonLinkSchema } from "@/lib/validation/salon-links";
import { STORE_ASSET_BUCKET, STORE_ASSET_SIGNED_URL_EXPIRES_IN, STORE_PHOTO_FOLDER } from "@/lib/store-assets/constants";
import { mapStoreAssetError, type StoreAssetLink, type StoreAssetPhoto } from "@/lib/store-assets/parse";
import { addStorePhoto, deleteStorePhoto, replaceStorePhoto, setStoreLogo, type StoreAssetDeps } from "@/lib/store-assets/service";

/**
 * 店舗別のロゴ・写真・リンクの保存・削除（0081 の RPC の薄いラッパー）。
 * 権限（書き込み権限者のみ。閲覧のみは不可）・店舗の一致・パスの検証・件数上限はすべて DB 側が最終判定する。
 * ここでは storeId を必ず画面（URL）から渡された値だけで使い、ユーザーIDなどから店舗を推測しない。
 *
 * 順序の方針:
 *  ・保存失敗・上限超過・結果不明のとき、アップロード済みの画像は削除しない（同時の別登録と競合して使用中の画像を消さないため。孤児として残る。service.ts）。
 *  ・差し替え・削除は「DB（権限判定を含む）→ Storage」の順。DBが拒否したら Storage は触らない。
 *  ・置き換えた古い画像（DB が返した前のパス）は Storage から削除する（発行済みの署名付きURLが残る時間を短くするため）。
 */
const uuid = z.string().uuid();
const logoPath = (storeId: string) => new RegExp(`^${storeId}/logo/[^/]+$`);
const photoPath = (storeId: string) => new RegExp(`^${storeId}/${STORE_PHOTO_FOLDER}/[^/]+$`);
const NOT_LOGGED_IN = "セッションが切れています。再度ログインしてください。";

type Fail = { success: false; error: string };

function depsFor(supabase: Awaited<ReturnType<typeof createClient>>): StoreAssetDeps {
  return {
    rpc: (fn, args) => looseRpc(supabase).rpc(fn, args) as ReturnType<StoreAssetDeps["rpc"]>,
    removeObjects: async (paths) => ({ error: (await supabase.storage.from(STORE_ASSET_BUCKET).remove(paths)).error }),
    sign: async (path) => {
      const { data, error } = await supabase.storage.from(STORE_ASSET_BUCKET).createSignedUrl(path, STORE_ASSET_SIGNED_URL_EXPIRES_IN);
      return error ? null : (data?.signedUrl ?? null);
    },
    log: (where, error) => logError(where, error),
  };
}

export async function setStoreLogoAction(
  storeId: string,
  storagePath: string | null,
): Promise<{ success: true; logoPath: string | null; logoUrl: string | null } | Fail> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: NOT_LOGGED_IN };
  if (!uuid.safeParse(storeId).success) return { success: false, error: "店舗を特定できませんでした。" };
  if (storagePath !== null && !logoPath(storeId).test(storagePath)) return { success: false, error: "画像の登録に失敗しました。もう一度アップロードしてください。" };
  return setStoreLogo(depsFor(supabase), storeId, storagePath);
}

export async function addStorePhotoAction(
  storeId: string,
  storagePath: string,
): Promise<{ success: true; photo: StoreAssetPhoto } | Fail> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: NOT_LOGGED_IN };
  if (!uuid.safeParse(storeId).success || !photoPath(storeId).test(storagePath)) {
    return { success: false, error: "画像の登録に失敗しました。もう一度アップロードしてください。" };
  }
  return addStorePhoto(depsFor(supabase), storeId, storagePath);
}

export async function replaceStorePhotoAction(
  storeId: string,
  photoId: string,
  storagePath: string,
): Promise<{ success: true; storagePath: string; url: string | null } | Fail> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: NOT_LOGGED_IN };
  if (!uuid.safeParse(storeId).success || !uuid.safeParse(photoId).success || !photoPath(storeId).test(storagePath)) {
    return { success: false, error: "画像の登録に失敗しました。もう一度アップロードしてください。" };
  }
  return replaceStorePhoto(depsFor(supabase), photoId, storagePath);
}

export async function deleteStorePhotoAction(photoId: string): Promise<{ success: true } | Fail> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: NOT_LOGGED_IN };
  if (!uuid.safeParse(photoId).success) return { success: false, error: "画像を特定できませんでした。" };
  return deleteStorePhoto(depsFor(supabase), photoId);
}

export async function addStoreLinkAction(
  storeId: string,
  input: { linkType: string; label: string; url: string },
): Promise<{ success: true; link: StoreAssetLink } | Fail> {
  const parsed = addSalonLinkSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "入力内容をご確認ください。" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: NOT_LOGGED_IN };
  if (!uuid.safeParse(storeId).success) return { success: false, error: "店舗を特定できませんでした。" };
  const v = parsed.data;
  const { data: row, error } = await looseRpc(supabase).rpc("add_store_link", { p_store_id: storeId, p_link_type: v.linkType, p_label: v.label || null, p_url: v.url });
  const r = row as { id?: string; sort_order?: number } | null;
  if (error || !r?.id) {
    logError("addStoreLinkAction", error ?? new Error("no row"));
    return { success: false, error: mapStoreAssetError(error?.message) };
  }
  return { success: true, link: { id: r.id, linkType: v.linkType, label: v.label || null, url: v.url, sortOrder: r.sort_order ?? 0 } };
}

export async function deleteStoreLinkAction(linkId: string): Promise<{ success: true } | Fail> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: NOT_LOGGED_IN };
  if (!uuid.safeParse(linkId).success) return { success: false, error: "リンクを特定できませんでした。" };
  const { error } = await looseRpc(supabase).rpc("delete_store_link", { p_link_id: linkId });
  if (error) {
    logError("deleteStoreLinkAction", error);
    return { success: false, error: mapStoreAssetError(error.message) };
  }
  return { success: true };
}
