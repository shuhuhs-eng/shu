/**
 * サロン画像（内装・雰囲気）の署名付きURL有効期限（秒）。
 *
 * ★"use server" ファイル（lib/salon-photos/actions.ts）は async function
 * 以外を export できない（Next.jsのServer Actionsのルール。値として
 * exportされる number/object/const 等があると
 * 「A "use server" file can only export async functions」という
 * エラーになる）。この定数はactions.tsから直接exportしていたために
 * このエラーの原因になっていたため、"use server" を持たない通常ファイル
 * （このファイル）へ切り出した。
 *
 * 既存 avatars 用の lib/storage/avatar.ts の
 * AVATAR_SIGNED_URL_EXPIRES_IN（1時間）と同じ方針・同じ値。
 */
export const SALON_PHOTO_SIGNED_URL_EXPIRES_IN = 60 * 60;
