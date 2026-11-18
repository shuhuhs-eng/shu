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
/** 店舗の写真は分類なしで1店舗あたり最大8枚（0084。DB の CHECK(sort_order 0〜7)＋unique(store_id, sort_order) が上限を保証する）。 */
export const STORE_PHOTO_MAX = 8;
/** 新しく登録する写真の保存先フォルダ名・category（0084。既存の interior / atmosphere は引き継がれ、画面では分類しない）。 */
export const STORE_PHOTO_FOLDER = "photo";
/**
 * 店舗の写真の表示枠（編集画面・プレビュー・美容師向け店舗詳細で共通）。
 * スマートフォンでも広い画面でも1枚ずつ横幅いっぱいの大きな枠（広い画面で小さな並びにならないよう、列は増やさない）。縦横比は 4:3 に統一し、object-cover で切り抜く（引き伸ばさない）。
 */
export const STORE_PHOTO_GRID_CLASS = "grid grid-cols-1 gap-3";
export const STORE_PHOTO_FRAME_CLASS = "relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-line bg-surface2";
export const STORE_PHOTO_IMAGE_CLASS = "h-full w-full object-cover";
export const STORE_LINK_MAX = 5;
