import { z } from "zod";
import { SPECIALTY_OPTIONS, VALUE_PRIORITY_OPTIONS, SNS_PLATFORMS } from "./profile-options";

const ageBandEnum = z.enum([
  "under_20", "20_24", "25_29", "30_34", "35_39", "40_44", "45_plus", "prefer_not_to_say",
]);
const genderEnum = z.enum(["male", "female", "other", "prefer_not_to_say"]);
const employmentTypeEnum = z.enum([
  "full_time", "part_time", "contract", "freelance", "owner", "other",
]);
const jobChangeIntentEnum = z.enum(["active", "passive", "not_looking"]);
const salaryBandEnum = z.enum(["lt_350", "350_450", "450_600", "600_800", "gt_800", "flexible"]);
const visibilityEnum = z.enum(["PRIVATE", "LIMITED", "PUBLIC"]);

const VALUE_PRIORITY_CODES = VALUE_PRIORITY_OPTIONS.map((o) => o.code) as [string, ...string[]];
const SNS_PLATFORM_CODES = SNS_PLATFORMS.map((p) => p.code) as [string, ...string[]];

/**
 * SNSリンク1件の検証。platformは現在Instagramのみ許可するが、
 * SNS_PLATFORMSに追加すればここも自動的に許可範囲が広がる（拡張可能設計）。
 */
const snsLinkSchema = z.object({
  platform: z.enum(SNS_PLATFORM_CODES),
  handle: z
    .string()
    .trim()
    .min(1, "アカウント名を入力してください")
    .max(40, "40文字以内で入力してください")
    .regex(/^[A-Za-z0-9._]*$/, "英数字・ピリオド・アンダースコアのみ使用できます"),
});

/**
 * プロフィールフォームの入力検証。
 * 個人情報(氏名・年代・性別) / 公開プロフィール(公開名・職務情報等) / 設定(公開範囲・スカウト受信)
 * を1フォームで検証するが、保存先テーブルは saveProfileAction 側で分離する。
 */
export const profileFormSchema = z.object({
  // --- 公開プロフィール（stylist_profiles） ---
  publicName: z.string().trim().min(1, "公開名を入力してください").max(40, "公開名は40文字以内で入力してください"),
  prefecture: z.string().trim().min(1, "都道府県を選択してください"),
  desiredWorkLocation: z.string().trim().max(100, "100文字以内で入力してください").optional().or(z.literal("")),
  experienceYears: z.coerce
    .number({ message: "半角数字で入力してください" })
    .int("整数で入力してください")
    .min(0, "0以上で入力してください")
    .max(60, "60以下で入力してください"),
  currentPosition: z.string().trim().max(60, "60文字以内で入力してください").optional().or(z.literal("")),
  specialties: z
    .array(z.enum(SPECIALTY_OPTIONS))
    .min(1, "得意技術を1つ以上選択してください"),
  employmentType: employmentTypeEnum,
  jobChangeIntent: jobChangeIntentEnum,
  desiredSalaryRange: salaryBandEnum,
  // SNSリンク（現在はInstagramのみUIに表示。0件=未入力も許可する）。
  snsLinks: z.array(snsLinkSchema).max(SNS_PLATFORMS.length, "登録できるSNSの数を超えています"),
  bio: z.string().trim().max(1000, "1000文字以内で入力してください").optional().or(z.literal("")),
  // avatar_path はStorage内のパス（"{uid}/{filename}"）。実際の所有権検証は
  // save_stylist_profile() RPC側で行う（ここでは軽い形式チェックのみ）。
  avatarPath: z
    .string()
    .trim()
    .max(300, "不正な値です")
    .regex(/^[^/]+\/[^/]+$/, "不正な値です")
    .optional()
    .or(z.literal("")),

  // --- 個人情報（stylist_private） ---
  fullName: z.string().trim().min(1, "氏名を入力してください").max(60, "60文字以内で入力してください"),
  ageBand: ageBandEnum,
  gender: genderEnum,

  // --- 働き方・価値観（stylist_profiles.value_priorities） ---
  // 候補約12項目から、重要な3つを優先順位付きで選択する（ちょうど3件必須）。
  valuePriorities: z
    .array(z.enum(VALUE_PRIORITY_CODES))
    .length(3, "重要な項目を3つ選択してください")
    .refine((arr) => new Set(arr).size === arr.length, "同じ項目を重複して選択できません"),

  // --- 設定（user_settings / stylist_profiles.visibility） ---
  scoutEnabled: z.enum(["true", "false"]),
  visibility: visibilityEnum,
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;
