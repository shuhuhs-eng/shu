import { z } from "zod";
import { parseExperienceYears } from "@/lib/profile/experience-years";
import { validateBirthDate } from "@/lib/profile/birth-date";
import { SPECIALTY_OPTIONS, VALUE_PRIORITY_OPTIONS, SNS_PLATFORMS } from "./profile-options";
import { SPECIALTIES_REQUIRED_MESSAGE } from "@/lib/profile/specialties-rule";

const ageBandEnum = z.enum([
  "under_20", "20_24", "25_29", "30_34", "35_39", "40_44", "45_plus", "prefer_not_to_say",
]);
const genderEnum = z.enum(["male", "female", "other", "prefer_not_to_say"]);
const employmentTypeEnum = z.enum([
  "full_time", "part_time", "contract", "freelance", "owner", "other",
]);
const jobChangeIntentEnum = z.enum(["active", "passive", "not_looking"]);
// 美容師プロフィールの公開範囲は「公開」「非公開」の二択（「一部公開」は選択肢から外した）。
const visibilityEnum = z.enum(["PRIVATE", "PUBLIC"]);

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
function specialtiesSchema(required: boolean) {
  const base = z.array(z.enum(SPECIALTY_OPTIONS));
  return required ? base.min(1, SPECIALTIES_REQUIRED_MESSAGE) : base;
}

function buildProfileFormSchema(specialties: ReturnType<typeof specialtiesSchema>) {
  return z.object({
  // --- 公開プロフィール（stylist_profiles） ---
  publicName: z.string().trim().min(1, "公開名を入力してください").max(40, "公開名は40文字以内で入力してください"),
  prefecture: z.string().trim().min(1, "都道府県を選択してください"),
  desiredWorkLocation: z.string().trim().max(100, "100文字以内で入力してください").optional().or(z.literal("")),
  // 空欄・空白は NULL（未登録）。明示的な 0 は 0。0へは変換しない（lib/profile/experience-years.ts）。
  experienceYears: z.unknown().transform((v, ctx): number | null => {
    const r = parseExperienceYears(v);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: r.message });
      return z.NEVER;
    }
    return r.value;
  }),
  currentPosition: z.string().trim().max(60, "60文字以内で入力してください").optional().or(z.literal("")),
  specialties,
  employmentType: employmentTypeEnum,
  jobChangeIntent: jobChangeIntentEnum,
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
  // 生年月日（必須。本人のみ確認・編集。サロンへは公開せず、満年齢または年代だけを返す）。
  // DB未対応（0070未適用）のときは入力欄ごと出さないため、項目が無い(undefined)場合だけ検査しない。
  // 項目があるのに空なら必須エラー（登録済みの生年月日を空にして「未登録に戻す」ことはできない）。
  birthDate: z
    .string()
    .trim()
    .optional()
    .superRefine((v, ctx) => {
      if (v === undefined) return;
      if (!v) {
        ctx.addIssue({ code: "custom", message: "生年月日を入力してください" });
        return;
      }
      const msg = validateBirthDate(v);
      if (msg) ctx.addIssue({ code: "custom", message: msg });
    }),
  // サロンへの年齢の表示方法（必須の初回選択。exact=実年齢 / decade=年代）。項目が無い(undefined)のはDB未対応のときだけ。
  ageDisplayMode: z
    .string()
    .optional()
    .superRefine((v, ctx) => {
      if (v === undefined) return;
      if (v !== "exact" && v !== "decade") ctx.addIssue({ code: "custom", message: "年齢の表示方法を選択してください" });
    })
    .transform((v) => (v === "exact" || v === "decade" ? (v as "exact" | "decade") : undefined)),

  // --- 働き方・価値観（stylist_profiles.value_priorities） ---
  // 候補約12項目から、重要な3つを優先順位付きで選択する（ちょうど3件必須）。
  valuePriorities: z
    .array(z.enum(VALUE_PRIORITY_CODES))
    .length(3, "重要な項目を3つ選択してください")
    .refine((arr) => new Set(arr).size === arr.length, "同じ項目を重複して選択できません"),

  // --- 設定（user_settings / stylist_profiles.visibility） ---
  visibility: visibilityEnum,
  });
}

/** 得意技術: 既定は1つ以上が必須。「いまの立場＝新卒」のときだけ任意（0件＝空配列で保存できる。lib/profile/specialties-rule.ts）。 */
export const profileFormSchema = buildProfileFormSchema(specialtiesSchema(true));
export const profileFormSchemaSpecialtiesOptional = buildProfileFormSchema(specialtiesSchema(false));

export type ProfileFormValues = z.infer<typeof profileFormSchema>;
