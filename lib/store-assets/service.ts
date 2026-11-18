import { mapStoreAssetError, parseStoreAssetsJson, type StoreAssetPhoto } from "@/lib/store-assets/parse";
import { STORE_PHOTO_FOLDER, STORE_PHOTO_MAX } from "@/lib/store-assets/constants";

/**
 * 店舗別ロゴ・写真の保存処理（DB 呼び出しと Storage 削除を注入できる形）。server action から使い、テストでは偽の依存を渡す。
 *
 * 画像の削除方針（同時操作によるデータ消失を避けるため）:
 *  ・保存に失敗した・上限を超えた・結果が不明、のいずれの場合も、今回アップロードした画像は **削除しない**（孤児として残す）。
 *    「未登録を確認してから削除」では、確認と削除の間に別のリクエストが同じ画像を登録すると、使用中の画像を消せてしまうため。
 *  ・削除するのは、DB が成功を返した後に DB 自身が「登録から外した」と返した画像だけ
 *    （ロゴ差し替えの前の画像／写真削除で返されたパス）。
 *  ・孤児画像はバケットに残る。掃除が必要なら、登録済みパスと突き合わせる運用（別手順）で行う。
 */
export type RpcError = { message: string; code?: string | null } | null;
export type StoreAssetDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }>;
  removeObjects: (paths: string[]) => Promise<{ error: RpcError }>;
  sign: (path: string) => Promise<string | null>;
  log: (where: string, error: unknown) => void;
};
export type Fail = { success: false; error: string };

export async function setStoreLogo(
  deps: StoreAssetDeps,
  storeId: string,
  storagePath: string | null,
): Promise<{ success: true; logoPath: string | null; logoUrl: string | null } | Fail> {
  const { data: prev, error } = await deps.rpc("set_store_logo", { p_store_id: storeId, p_storage_path: storagePath });
  if (error) {
    deps.log("setStoreLogo", error);
    return { success: false, error: mapStoreAssetError(error.message) };
  }
  // 置き換えた古い画像（DB が返した値）だけを消す。同じパスの再送（prev が今回と同じ）は消さない。
  if (typeof prev === "string" && prev !== storagePath) {
    const { error: removeError } = await deps.removeObjects([prev]);
    if (removeError) deps.log("setStoreLogo.removePrev", removeError);
  }
  return { success: true, logoPath: storagePath, logoUrl: storagePath ? await deps.sign(storagePath) : null };
}

/**
 * 店舗の写真を追加する（分類なし・1店舗最大8枚。0084）。
 * 並び順（空き番号）と8枚の上限は DB が決める（店舗ごとの排他ロック＋制約）。ここでの枚数確認は、無駄なやり取りを避けるための事前確認にすぎない。
 * 上限超過・失敗・結果不明のとき、アップロード済みの画像は削除しない（孤児として残す）。
 */
export async function addStorePhoto(
  deps: StoreAssetDeps,
  storeId: string,
  storagePath: string,
): Promise<{ success: true; photo: StoreAssetPhoto } | Fail> {
  const { data: current, error: readError } = await deps.rpc("get_store_assets", { p_store_id: storeId });
  const parsed = readError ? null : parseStoreAssetsJson(current, storeId);
  if (!parsed) return { success: false, error: mapStoreAssetError(readError?.message) }; // 確認できない: 何も消さない
  // 同じパスが既に登録済み（重複送信・保存後に応答だけ失われて再送）: 二重登録せず、登録済みのものを成功として返す
  const existing = parsed.photos.find((p) => p.storagePath === storagePath);
  if (existing) return { success: true, photo: { ...existing, url: await deps.sign(storagePath) } };
  if (parsed.logoPath === storagePath) {
    return { success: false, error: "画像の登録に失敗しました。もう一度アップロードしてください。" }; // 別の用途で使用中: 触らない
  }
  if (parsed.photos.length >= STORE_PHOTO_MAX) {
    // 上限超過: 画像は削除しない（確認後の削除は、同時の別登録と競合し得るため。孤児として残す）
    return { success: false, error: mapStoreAssetError("maximum of 8 photos") };
  }
  // p_sort_order は互換のための引数（DB は無視して空き番号に入れる）。分類は付けない（category = photo）。
  const { data: row, error } = await deps.rpc("add_store_photo", { p_store_id: storeId, p_category: STORE_PHOTO_FOLDER, p_storage_path: storagePath, p_sort_order: 0 });
  const r = row as { id?: string; sort_order?: number } | null;
  if (error || !r?.id) {
    deps.log("addStorePhoto", error ?? new Error("no row"));
    // 拒否・通信失敗・結果不明のいずれでも、アップロード済みの画像は消さない
    return { success: false, error: mapStoreAssetError(error?.message) };
  }
  return { success: true, photo: { id: r.id, category: "photo", storagePath, sortOrder: r.sort_order ?? parsed.photos.length, url: await deps.sign(storagePath) } };
}

/**
 * 店舗の写真を差し替える（同じ枠・同じ並び順のまま画像だけ入れ替える。8枚の状態でも可能）。
 * ★置き換え前の画像は Storage から削除しない（残す）。DB の応答（旧パス）を受けてから削除するまでの間に、別のリクエストが
 *   同じ旧パスを再登録すると、使用中の画像を消してしまうため。使われなくなった旧画像は孤児として残り、自動掃除はしない
 *   （必要なら、登録済みパスと突き合わせる運用で別途掃除する）。失敗時も何も消さない。
 */
export async function replaceStorePhoto(
  deps: StoreAssetDeps,
  photoId: string,
  storagePath: string,
): Promise<{ success: true; storagePath: string; url: string | null } | Fail> {
  const { error } = await deps.rpc("replace_store_photo", { p_photo_id: photoId, p_storage_path: storagePath });
  if (error) {
    deps.log("replaceStorePhoto", error);
    return { success: false, error: mapStoreAssetError(error.message) };
  }
  return { success: true, storagePath, url: await deps.sign(storagePath) };
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
