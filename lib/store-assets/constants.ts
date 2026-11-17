/**
 * 店舗別のロゴ・写真・リンク（0081）の定数。
 *
 * ★署名付きURLの有効期限は300秒（5分）。既存の avatars / salon-photos の1時間より短くしている。
 *   理由: 店舗を非公開にした後・画像を差し替えた後も、発行済みの署名付きURLは期限まで使えるため（Storage の
 *   アクセス判定は発行時に行われ、期限内は再判定されない）、取り消しの遅れを最大5分に抑える。
 *   さらに画像のアップロードは cacheControl を60秒にして、CDN・ブラウザに残る時間を短くしている。
 *   差し替え・削除では、置き換えた古い画像を Storage から削除する（削除後は発行済みURLでも取得できなくなる想定。
 *   実機の Supabase での確認は未実施）。
 */
export const STORE_ASSET_BUCKET = "salon-store-assets";
export const STORE_ASSET_SIGNED_URL_EXPIRES_IN = 300;
export const STORE_ASSET_CACHE_CONTROL = "60";
export const STORE_ASSET_MAX_BYTES = 5 * 1024 * 1024;
export const STORE_ASSET_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const STORE_PHOTO_MAX = 3;
export const STORE_LINK_MAX = 5;
