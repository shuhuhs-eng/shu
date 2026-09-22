import { z } from "zod";

/**
 * サロン画像（内装・雰囲気、0014で追加）まわりの入力検証。
 *
 * ★今回はバックエンド設計のみのスコープのため、このスキーマを実際に
 * 使うアップロードUI・Server Actionはまだ実装していない（将来、
 * lib/salon-photos/actions.ts のようなServer Actionから使う想定）。
 *
 * storage_pathの実際の所有権・実在確認はクライアント側のzod検証では
 * 不可能なため、add_salon_photo() RPC（SECURITY DEFINER、SQL側）が
 * 最終的な検証を行う。ここでの検証は「明らかに不正な形式を早期に弾く」
 * という補助的な役割にとどまる（既存のavatarPathスキーマと同じ位置づけ）。
 */
export const salonPhotoCategorySchema = z.enum(["interior", "atmosphere"]);

export const salonPhotoStoragePathSchema = z
  .string()
  .trim()
  .min(1, "storage_pathが必要です")
  .max(400, "不正な値です")
  // {salon_user_id}/{category}/{filename} の3階層形式のみ許可する
  // （最終的な所有権・実在確認はadd_salon_photo() RPC側で行う）。
  .regex(/^[^/]+\/(interior|atmosphere)\/[^/]+$/, "不正な値です");

export const salonPhotoSortOrderSchema = z.number().int().min(0).max(2);

export const addSalonPhotoSchema = z.object({
  category: salonPhotoCategorySchema,
  storagePath: salonPhotoStoragePathSchema,
  sortOrder: salonPhotoSortOrderSchema,
});

export type AddSalonPhotoInput = z.infer<typeof addSalonPhotoSchema>;
