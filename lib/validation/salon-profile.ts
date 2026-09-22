import { z } from "zod";
import { SPECIALTY_OPTIONS } from "./profile-options";

const visibilityEnum = z.enum(["PRIVATE", "LIMITED", "PUBLIC"]);

/**
 * HOTPEPPER Beauty URLの検証（0014で追加）。
 * ・null / 空文字を許可（未登録可）。
 * ・https の beauty.hotpepper.jp 配下のURLのみ許可
 *   （save_salon_profile() RPC側のCHECK制約・正規表現と同じ方針）。
 */
export const hotpepperUrlSchema = z
  .string()
  .trim()
  .regex(/^https:\/\/beauty\.hotpepper\.jp\/.+$/, "HOTPEPPER BeautyのサロンページURL（https://beauty.hotpepper.jp/…）を入力してください")
  .optional()
  .or(z.literal(""));

/**
 * サロンプロフィールフォームの入力検証。
 * lib/validation/profile.ts（stylist側）と対称構造。
 * サロンには個人情報テーブル(stylist_privateに相当するもの)が無いため、
 * その区分に相当するフィールドは存在しない。
 */
export const salonProfileFormSchema = z.object({
  // --- 公開プロフィール（salon_profiles） ---
  salonName: z.string().trim().min(1, "サロン名を入力してください").max(60, "サロン名は60文字以内で入力してください"),
  prefecture: z.string().trim().min(1, "都道府県を選択してください"),
  city: z.string().trim().max(100, "100文字以内で入力してください").optional().or(z.literal("")),
  streetAddress: z.string().trim().max(200, "200文字以内で入力してください").optional().or(z.literal("")),
  cultureDescription: z
    .string()
    .trim()
    .max(2000, "2000文字以内で入力してください")
    .optional()
    .or(z.literal("")),
  // employee_size_code は employee_size_master を参照する動的なコードのため、
  // 固定enumでは検証しない（実在確認はDB外部キー制約とRPC側に委ねる）。
  employeeSizeCode: z.string().trim().max(50, "不正な値です").optional().or(z.literal("")),
  targetSpecialties: z
    .array(z.enum(SPECIALTY_OPTIONS))
    .min(1, "採用したい得意技術を1つ以上選択してください"),
  instagramHandle: z
    .string()
    .trim()
    .max(40, "40文字以内で入力してください")
    .regex(/^[A-Za-z0-9._]*$/, "英数字・ピリオド・アンダースコアのみ使用できます")
    .optional()
    .or(z.literal("")),
  bio: z.string().trim().max(1000, "1000文字以内で入力してください").optional().or(z.literal("")),
  // avatar_path はStorage内のパス。実際の所有権検証はsave_salon_profile() RPC側で行う
  // （stylist側と共通のavatarsバケット・共通のvalidate_and_normalize_avatar_path()）。
  avatarPath: z
    .string()
    .trim()
    .max(300, "不正な値です")
    .regex(/^[^/]+\/[^/]+$/, "不正な値です")
    .optional()
    .or(z.literal("")),
  // HOTPEPPER Beauty URL（0014で追加）。null/空文字許可、
  // https://beauty.hotpepper.jp/ 配下のURLのみ許可（save_salon_profile()
  // RPC側のCHECK制約・正規表現と同じ方針）。既存フィールドの検証には
  // 一切影響しない（新規フィールドの追加のみ）。
  hotpepperUrl: hotpepperUrlSchema,

  // --- 公開範囲（salon_profiles.visibility） ---
  visibility: visibilityEnum,
});

export type SalonProfileFormValues = z.infer<typeof salonProfileFormSchema>;
