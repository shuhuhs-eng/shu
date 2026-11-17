import { nextFreeSortOrder, mapStoreAssetError, parseStoreAssetsJson, type StoreAssetPhoto } from "@/lib/store-assets/parse";
import { STORE_PHOTO_MAX } from "@/lib/store-assets/constants";

/**
 * 店舗別ロゴ・写真の保存処理（DB 呼び出しと Storage 削除を注入できる形）。server action から使い、テストでは偽の依存を渡す。
 *
 * 画像を消してよいのは次の3つが「すべて」成り立つ場合だけ（それ以外は残す。孤児ファイルは残っても安全側）:
 *  1. DB が確定的に拒否した（エラーコードがある＝DB が応答して処理を取り消した）。通信失敗・タイムアウトなど
 *     「保存されたかどうか分からない」場合は消さない（保存済みで応答だけ失われた可能性がある）。
 *  2. 登録内容を取り直せた（取れない＝確認できない場合は消さない）。
 *  3. その画像のパスが、この店舗の現在のロゴ・写真のどれにも登録されていない
 *     （同じパスの重複送信で、先に成功した登録の画像を消さない）。
 */
export type RpcError = { message: string; code?: string | null } | null;
export type StoreAssetDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }>;
  removeObjects: (paths: string[]) => Promise<{ error: RpcError }>;
  sign: (path: string) => Promise<string | null>;
  log: (where: string, error: unknown) => void;
};
export type Fail = { success: false; error: string };

/** DB（PostgREST）が応答したエラーか。code が空・無い（通信失敗など）なら結果不明として扱う。 */
export function isDefiniteRejection(error: RpcError): boolean {
  return !!error && typeof error.code === "string" && error.code.length > 0;
}

/** 条件を満たすときだけ画像を削除する。消したら true。 */
export async function removeUploadedIfSafe(deps: StoreAssetDeps, storeId: string, path: string, error: RpcError, where: string): Promise<boolean> {
  if (!isDefiniteRejection(error)) return false; // 保存結果が不明: 消さない
  const { data, error: readError } = await deps.rpc("get_store_assets", { p_store_id: storeId });
  if (readError) return false; // 登録内容を確認できない: 消さない
  const parsed = parseStoreAssetsJson(data, storeId);
  if (!parsed) return false;
  if (parsed.logoPath === path || parsed.photos.some((p) => p.storagePath === path)) return false; // 使用中: 消さない
  const { error: removeError } = await deps.removeObjects([path]);
  if (removeError) deps.log(`${where}.remove`, removeError);
  return !removeError;
}

export async function setStoreLogo(
  deps: StoreAssetDeps,
  storeId: string,
  storagePath: string | null,
): Promise<{ success: true; logoPath: string | null; logoUrl: string | null } | Fail> {
  const { data: prev, error } = await deps.rpc("set_store_logo", { p_store_id: storeId, p_storage_path: storagePath });
  if (error) {
    deps.log("setStoreLogo", error);
    if (storagePath) await removeUploadedIfSafe(deps, storeId, storagePath, error, "setStoreLogo.cleanup");
    return { success: false, error: mapStoreAssetError(error.message) };
  }
  // 置き換えた古い画像（DB が返した値）だけを消す。同じパスの再送（prev が今回と同じ）は消さない。
  if (typeof prev === "string" && prev !== storagePath) {
    const { error: removeError } = await deps.removeObjects([prev]);
    if (removeError) deps.log("setStoreLogo.removePrev", removeError);
  }
  return { success: true, logoPath: storagePath, logoUrl: storagePath ? await deps.sign(storagePath) : null };
}

export async function addStorePhoto(
  deps: StoreAssetDeps,
  storeId: string,
  category: "interior" | "atmosphere",
  storagePath: string,
): Promise<{ success: true; photo: StoreAssetPhoto } | Fail> {
  const { data: current, error: readError } = await deps.rpc("get_store_assets", { p_store_id: storeId });
  const parsed = readError ? null : parseStoreAssetsJson(current, storeId);
  if (!parsed) return { success: false, error: mapStoreAssetError(readError?.message) }; // 確認できない: 何も消さない
  // 同じパスが既に登録済み（重複送信・保存後に応答だけ失われて再送）: 二重登録せず、登録済みのものを成功として返す
  const existing = parsed.photos.find((p) => p.storagePath === storagePath && p.category === category);
  if (existing) return { success: true, photo: { ...existing, url: await deps.sign(storagePath) } };
  if (parsed.logoPath === storagePath || parsed.photos.some((p) => p.storagePath === storagePath)) {
    return { success: false, error: "画像の登録に失敗しました。もう一度アップロードしてください。" }; // 別の用途で使用中: 触らない
  }
  const sortOrder = nextFreeSortOrder(parsed.photos.filter((p) => p.category === category).map((p) => p.sortOrder), STORE_PHOTO_MAX);
  if (sortOrder === null) {
    // 上限超過（DB は呼んでいない＝未登録が確定）。未登録なので今回アップロードした画像だけ片付ける
    await deps.removeObjects([storagePath]).then(({ error }) => error && deps.log("addStorePhoto.cleanup", error));
    return { success: false, error: "このカテゴリの画像は既に3枚登録されています。" };
  }
  const { data: row, error } = await deps.rpc("add_store_photo", { p_store_id: storeId, p_category: category, p_storage_path: storagePath, p_sort_order: sortOrder });
  const r = row as { id?: string; sort_order?: number } | null;
  if (error || !r?.id) {
    deps.log("addStorePhoto", error ?? new Error("no row"));
    // error が無いのに行が無い、または通信失敗: 結果不明なので消さない。DB の確定拒否のときだけ、未登録を確認して消す
    if (error) await removeUploadedIfSafe(deps, storeId, storagePath, error, "addStorePhoto.cleanup");
    return { success: false, error: mapStoreAssetError(error?.message) };
  }
  return { success: true, photo: { id: r.id, category, storagePath, sortOrder: r.sort_order ?? sortOrder, url: await deps.sign(storagePath) } };
}

export async function deleteStorePhoto(deps: StoreAssetDeps, photoId: string): Promise<{ success: true } | Fail> {
  const { data: path, error } = await deps.rpc("delete_store_photo", { p_photo_id: photoId });
  if (error) {
    deps.log("deleteStorePhoto", error);
    return { success: false, error: mapStoreAssetError(error.message) };
  }
  if (typeof path === "string") {
    const { error: removeError } = await deps.removeObjects([path]);
    if (removeError) deps.log("deleteStorePhoto.storage", removeError);
  }
  return { success: true };
}
