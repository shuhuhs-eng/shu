import type { SupabaseClient } from "@supabase/supabase-js";
import { looseRpc } from "@/lib/diagnosis-limit/rpc";
import { logError } from "@/lib/security/log";
import { STORE_ASSET_BUCKET, STORE_ASSET_SIGNED_URL_EXPIRES_IN } from "@/lib/store-assets/constants";
import { isStoreAssetsUnavailable, parseStoreAssetsJson, type StoreAssetsData } from "@/lib/store-assets/parse";

/**
 * 店舗別のロゴ・写真・リンクの読み取り（0081 の RPC）。
 *  audience="staff"   … 店舗の担当者・プレビュー（get_store_assets。公開状態は問わない）
 *  audience="stylist" … 美容師向け（get_public_store_assets。PUBLIC の店舗だけ）
 * 結果:
 *  ok          … 取得できた（空でもよい）
 *  unavailable … 0081 が未適用。呼び出し側は従来の表示・編集のままにする（エラー扱いにしない）
 *  error       … 取得に失敗。呼び出し側は「読み込めませんでした」を出し、保存系の欄は出さない
 * 画像は署名付きURL（有効期限 STORE_ASSET_SIGNED_URL_EXPIRES_IN 秒）で返す。永続的な公開URLは作らない。
 */
export type LoadStoreAssetsResult =
  | { status: "ok"; assets: StoreAssetsData }
  | { status: "unavailable" }
  | { status: "error" };

export async function loadStoreAssets(
  supabase: SupabaseClient,
  storeId: string,
  audience: "staff" | "stylist",
): Promise<LoadStoreAssetsResult> {
  const fn = audience === "staff" ? "get_store_assets" : "get_public_store_assets";
  const { data, error } = await looseRpc(supabase).rpc(fn, { p_store_id: storeId });
  if (error) {
    if (isStoreAssetsUnavailable(error)) return { status: "unavailable" };
    logError(`loadStoreAssets.${audience}`, error);
    return { status: "error" };
  }
  const parsed = parseStoreAssetsJson(data, storeId);
  if (!parsed) {
    logError(`loadStoreAssets.${audience}.shape`, new Error("unexpected shape"));
    return { status: "error" };
  }
  const paths = [...(parsed.logoPath ? [parsed.logoPath] : []), ...parsed.photos.map((p) => p.storagePath)];
  const urlByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed, error: signError } = await supabase.storage
      .from(STORE_ASSET_BUCKET)
      .createSignedUrls(paths, STORE_ASSET_SIGNED_URL_EXPIRES_IN);
    if (signError) logError(`loadStoreAssets.${audience}.sign`, signError);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }
  return {
    status: "ok",
    assets: {
      ...parsed,
      logoUrl: parsed.logoPath ? (urlByPath.get(parsed.logoPath) ?? null) : null,
      photos: parsed.photos.map((p) => ({ ...p, url: urlByPath.get(p.storagePath) ?? null })),
    },
  };
}
