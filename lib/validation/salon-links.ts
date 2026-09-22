import { z } from "zod";

/**
 * サロン外部リンク（salon_links、0015で追加）まわりの入力検証。
 *
 * ★既存の instagramHandle（ハンドル名のみ、@なしの英数字）・hotpepperUrl
 * （salon_profiles.hotpepper_url専用）のバリデーションとは完全に独立して
 * いる。既存2つのvalidation（lib/validation/salon-profile.ts）は一切
 * 変更していない。
 */
export const salonLinkTypeSchema = z.enum(["website", "recruit", "instagram", "hotpepper", "other"]);

export const SALON_LINK_TYPE_LABELS: Record<
  "website" | "recruit" | "instagram" | "hotpepper" | "other",
  string
> = {
  hotpepper: "HOTPEPPER Beauty",
  website: "公式ホームページ",
  recruit: "求人・自社LP",
  instagram: "Instagram",
  other: "その他",
};

const genericHttpsUrlSchema = z
  .string()
  .trim()
  .min(1, "URLを入力してください")
  .regex(/^https:\/\/.+$/, "https:// から始まるURLを入力してください")
  .max(500, "不正な値です");

const instagramUrlSchema = z
  .string()
  .trim()
  .min(1, "URLを入力してください")
  .regex(/^https:\/\/(www\.)?instagram\.com\/.+$/, "InstagramのプロフィールURL（https://www.instagram.com/…）を入力してください")
  .max(500, "不正な値です");

const hotpepperLinkUrlSchema = z
  .string()
  .trim()
  .min(1, "URLを入力してください")
  .regex(/^https:\/\/beauty\.hotpepper\.jp\/.+$/, "HOTPEPPER BeautyのサロンページURL（https://beauty.hotpepper.jp/…）を入力してください")
  .max(500, "不正な値です");

/** link_typeに応じたURLの検証スキーマを返す。 */
export function urlSchemaForLinkType(linkType: string) {
  if (linkType === "instagram") return instagramUrlSchema;
  if (linkType === "hotpepper") return hotpepperLinkUrlSchema;
  return genericHttpsUrlSchema; // website / recruit / other
}

export const salonLinkLabelSchema = z
  .string()
  .trim()
  .max(40, "40文字以内で入力してください")
  .optional()
  .or(z.literal(""));

export const addSalonLinkSchema = z
  .object({
    linkType: salonLinkTypeSchema,
    label: salonLinkLabelSchema,
    url: z.string().trim().min(1, "URLを入力してください"),
  })
  .superRefine((val: { linkType: string; url: string }, ctx: z.RefinementCtx) => {
    const schema = urlSchemaForLinkType(val.linkType);
    const result = schema.safeParse(val.url);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: result.error.issues[0]?.message ?? "URLの形式が正しくありません",
      });
    }
  });

export type AddSalonLinkInput = z.infer<typeof addSalonLinkSchema>;
