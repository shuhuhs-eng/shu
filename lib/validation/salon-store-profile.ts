import { z } from "zod";
import { SPECIALTY_OPTIONS } from "./profile-options";
import { hotpepperUrlSchema } from "./salon-profile";

const visibilityEnum = z.enum(["PRIVATE", "LIMITED", "PUBLIC"]);

/**
 * 店舗単位プロフィールフォームの入力検証（法人・複数店舗対応 Phase 3B）。
 * lib/validation/salon-profile.ts（旧・user_id単位）と対称構造。
 *
 * ★既存lib/validation/salon-profile.tsは一切変更していない（hotpepperUrlSchemaを
 * importして再利用するのみ）。avatar_path / instagram_handle は0029の
 * salon_store_profilesに含めていない列のため、ここでは検証しない
 * （avatar・写真・外部リンクは引き続きuser_id単位のまま、Phase 3Bの対象外）。
 */
export const salonStoreProfileFormSchema = z.object({
  salonName: z.string().trim().min(1, "店舗名を入力してください").max(60, "店舗名は60文字以内で入力してください"),
  prefecture: z.string().trim().min(1, "都道府県を選択してください"),
  city: z.string().trim().max(100, "100文字以内で入力してください").optional().or(z.literal("")),
  streetAddress: z.string().trim().max(200, "200文字以内で入力してください").optional().or(z.literal("")),
  cultureDescription: z
    .string()
    .trim()
    .max(2000, "2000文字以内で入力してください")
    .optional()
    .or(z.literal("")),
  employeeSizeCode: z.string().trim().max(50, "不正な値です").optional().or(z.literal("")),
  targetSpecialties: z
    .array(z.enum(SPECIALTY_OPTIONS))
    .min(1, "採用したい得意技術を1つ以上選択してください"),
  bio: z.string().trim().max(1000, "1000文字以内で入力してください").optional().or(z.literal("")),
  hotpepperUrl: hotpepperUrlSchema,
  visibility: visibilityEnum,
});

export type SalonStoreProfileFormValues = z.infer<typeof salonStoreProfileFormSchema>;
