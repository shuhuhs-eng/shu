import { z } from "zod";

/**
 * 「ロゴ・写真・リンクを編集」画面のロゴ保存の入力検証。
 * サロン名・所在地・紹介文・公開設定などの旧プロフィール項目は扱わない（店舗プロフィールで編集する）。
 * 実際の所有権検証は update_salon_logo() RPC 側（validate_and_normalize_avatar_path）で行う。
 */
export const salonLogoFormSchema = z.object({
  avatarPath: z
    .string()
    .trim()
    .max(300, "不正な値です")
    .regex(/^[^/]+\/[^/]+$/, "不正な値です")
    .optional()
    .or(z.literal("")),
});
