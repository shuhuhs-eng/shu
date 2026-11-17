import type { SalonLinkType, SalonPhotoCategory } from "@/types/database";

/** get_store_assets / get_public_store_assets（0081）が返す JSON を、画面用の形に直す純粋関数群。 */
export type StoreAssetPhoto = { id: string; category: SalonPhotoCategory; storagePath: string; sortOrder: number; url: string | null };
export type StoreAssetLink = { id: string; linkType: SalonLinkType; label: string | null; url: string; sortOrder: number };
export type StoreAssetsData = {
  storeId: string;
  logoPath: string | null;
  logoUrl: string | null;
  photos: StoreAssetPhoto[];
  links: StoreAssetLink[];
};

export type ParsedStoreAssets = { storeId: string; logoPath: string | null; photos: Omit<StoreAssetPhoto, "url">[]; links: StoreAssetLink[] };

const LINK_TYPES: readonly string[] = ["website", "recruit", "instagram", "hotpepper", "other"];

/** RPC の戻り値（unknown）を安全に読む。形が違うものは捨てる（画面を壊さない）。 */
export function parseStoreAssetsJson(raw: unknown, storeId: string): ParsedStoreAssets | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.store_id !== storeId) return null; // 別店舗の内容が混ざらないよう、要求した店舗と一致しなければ捨てる
  const photos = Array.isArray(o.photos) ? o.photos : [];
  const links = Array.isArray(o.links) ? o.links : [];
  return {
    storeId,
    logoPath: typeof o.logo_path === "string" && o.logo_path.startsWith(`${storeId}/`) ? o.logo_path : null,
    photos: photos.flatMap((p) => {
      const r = p as Record<string, unknown>;
      if (typeof r.id !== "string" || typeof r.storage_path !== "string" || !r.storage_path.startsWith(`${storeId}/`)) return [];
      if (r.category !== "interior" && r.category !== "atmosphere") return [];
      return [{ id: r.id, category: r.category as SalonPhotoCategory, storagePath: r.storage_path, sortOrder: Number(r.sort_order) || 0 }];
    }),
    links: links.flatMap((k) => {
      const r = k as Record<string, unknown>;
      if (typeof r.id !== "string" || typeof r.url !== "string" || typeof r.link_type !== "string" || !LINK_TYPES.includes(r.link_type)) return [];
      if (!/^https:\/\//.test(r.url)) return [];
      return [{ id: r.id, linkType: r.link_type as SalonLinkType, label: typeof r.label === "string" ? r.label : null, url: r.url, sortOrder: Number(r.sort_order) || 0 }];
    }),
  };
}

/** 0081 が未適用（関数が存在しない）かどうか。未適用の間は、従来どおりの表示・編集に戻す。 */
export function isStoreAssetsUnavailable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return /could not find the function|function .* does not exist/i.test(error.message ?? "");
}

/** 空きの最小の並び順（0 〜 max-1）。空きが無ければ null。 */
export function nextFreeSortOrder(used: number[], max: number): number | null {
  for (let i = 0; i < max; i++) if (!used.includes(i)) return i;
  return null;
}

/** DB のエラー文言を、利用者向けの文言に直す。内部の詳細は返さない。 */
export function mapStoreAssetError(message: string | undefined): string {
  const m = message ?? "";
  if (/not editable|not accessible|permission/i.test(m)) return "この店舗のロゴ・写真・リンクを変更する権限がありません（閲覧のみの権限では変更できません）。";
  if (/maximum of 5|duplicate key/i.test(m)) return "登録できる上限に達しています。";
  if (/violates check constraint/i.test(m)) return "URLの形式が正しくありません。";
  if (/must be under the store folder|kind segment|not found/i.test(m)) return "画像の登録に失敗しました。もう一度アップロードしてください。";
  return "保存に失敗しました。もう一度お試しください。";
}

/** 画面に出すロゴ・写真・リンクが1つでもあるか。 */
export function hasAnyStoreAsset(a: Pick<StoreAssetsData, "logoPath" | "photos" | "links"> | null): boolean {
  return !!a && (!!a.logoPath || a.photos.length > 0 || a.links.length > 0);
}
