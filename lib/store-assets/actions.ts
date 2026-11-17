"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { looseRpc } from "@/lib/diagnosis-limit/rpc";
import { logError } from "@/lib/security/log";
import { addSalonLinkSchema } from "@/lib/validation/salon-links";
import { STORE_ASSET_BUCKET, STORE_ASSET_SIGNED_URL_EXPIRES_IN, STORE_PHOTO_MAX } from "@/lib/store-assets/constants";
import { mapStoreAssetError, nextFreeSortOrder, parseStoreAssetsJson, type StoreAssetLink, type StoreAssetPhoto } from "@/lib/store-assets/parse";

/**
 * 店舗別のロゴ・写真・リンクの保存・削除（0081 の RPC の薄いラッパー）。
 * 権限（書き込み権限者のみ。閲覧のみは不可）・店舗の一致・パスの検証・件数上限はすべて DB 側が最終判定する。
 * ここでは storeId を必ず画面（URL）から渡された値だけで使い、ユーザーIDなどから店舗を推測しない。
 *
 * 順序の方針:
 *  ・アップロード済みの画像は、DB登録に失敗したら削除する（孤児を残さない）。
 *  ・差し替え・削除は「DB（権限判定を含む）→ Storage」の順。DBが拒否したら Storage は触らない。
 *  ・置き換えた古い画像は Storage から削除する（発行済みの署名付きURLが残る時間を短くするため）。
 */
const uuid = z.string().uuid();
const logoPath = (storeId: string) => new RegExp(`^${storeId}/logo/[^/]+$`);
const photoPath = (storeId: string, category: string) => new RegExp(`^${storeId}/${category}/[^/]+$`);
const NOT_LOGGED_IN = "セッションが切れています。再度ログインしてください。";

type Fail = { success: false; error: string };

async function sign(supabase: Awaited<ReturnType<typeof createClient>>, path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(STORE_ASSET_BUCKET).createSignedUrl(path, STORE_ASSET_SIGNED_URL_EXPIRES_IN);
  return error ? null : (data?.signedUrl ?? null);
}
async function removeObjects(supabase: Awaited<ReturnType<typeof createClient>>, paths: string[], where: string) {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(STORE_ASSET_BUCKET).remove(paths);
  if (error) logError(where, error);
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

  const { data: prev, error } = await looseRpc(supabase).rpc("set_store_logo", { p_store_id: storeId, p_storage_path: storagePath });
  if (error) {
    logError("setStoreLogoAction", error);
    if (storagePath) await removeObjects(supabase, [storagePath], "setStoreLogoAction.cleanup");
    return { success: false, error: mapStoreAssetError(error.message) };
  }
  if (typeof prev === "string" && prev !== storagePath) await removeObjects(supabase, [prev], "setStoreLogoAction.removePrev");
  return { success: true, logoPath: storagePath, logoUrl: storagePath ? await sign(supabase, storagePath) : null };
}

export async function addStorePhotoAction(
  storeId: string,
  category: "interior" | "atmosphere",
  storagePath: string,
): Promise<{ success: true; photo: StoreAssetPhoto } | Fail> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: NOT_LOGGED_IN };
  if (!uuid.safeParse(storeId).success || (category !== "interior" && category !== "atmosphere") || !photoPath(storeId, category).test(storagePath)) {
    return { success: false, error: "画像の登録に失敗しました。もう一度アップロードしてください。" };
  }
  const rpc = looseRpc(supabase).rpc;
  const { data: current, error: readError } = await rpc("get_store_assets", { p_store_id: storeId });
  const parsed = readError ? null : parseStoreAssetsJson(current, storeId);
  const used = (parsed?.photos ?? []).filter((p) => p.category === category).map((p) => p.sortOrder);
  const sortOrder = nextFreeSortOrder(used, STORE_PHOTO_MAX);
  if (!parsed || sortOrder === null) {
    await removeObjects(supabase, [storagePath], "addStorePhotoAction.cleanup");
    return { success: false, error: parsed ? "このカテゴリの画像は既に3枚登録されています。" : mapStoreAssetError(readError?.message) };
  }
  const { data: row, error } = await rpc("add_store_photo", { p_store_id: storeId, p_category: category, p_storage_path: storagePath, p_sort_order: sortOrder });
  const r = row as { id?: string; sort_order?: number } | null;
  if (error || !r?.id) {
    logError("addStorePhotoAction", error ?? new Error("no row"));
    await removeObjects(supabase, [storagePath], "addStorePhotoAction.cleanup");
    return { success: false, error: mapStoreAssetError(error?.message) };
  }
  return { success: true, photo: { id: r.id, category, storagePath, sortOrder: r.sort_order ?? sortOrder, url: await sign(supabase, storagePath) } };
}

export async function deleteStorePhotoAction(photoId: string): Promise<{ success: true } | Fail> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: NOT_LOGGED_IN };
  if (!uuid.safeParse(photoId).success) return { success: false, error: "画像を特定できませんでした。" };
  const { data: path, error } = await looseRpc(supabase).rpc("delete_store_photo", { p_photo_id: photoId });
  if (error) {
    logError("deleteStorePhotoAction", error);
    return { success: false, error: mapStoreAssetError(error.message) };
  }
  if (typeof path === "string") await removeObjects(supabase, [path], "deleteStorePhotoAction.storage");
  return { success: true };
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
