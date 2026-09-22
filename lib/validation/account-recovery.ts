import { z } from "zod";

/**
 * /account-recovery（登録メールアドレスが分からない方向けの問い合わせフォーム）の検証。
 * このフォーム自体はアカウントの存在確認を行わない（送信内容を保存するだけ）。
 * 項目リストで明示的に「(任意)」とされているのはInstagramアカウントのみのため、
 * それ以外は必須として扱う（他の登録フォームと同じ規約）。
 */
export const accountRecoverySchema = z.object({
  displayName: z.string().trim().min(1, "登録時の表示名を入力してください").max(60, "60文字以内で入力してください"),
  accountType: z.enum(["stylist", "salon"], { message: "アカウント種別を選択してください" }),
  salonName: z.string().trim().min(1, "所属サロン名を入力してください").max(60, "60文字以内で入力してください"),
  prefecture: z.string().trim().min(1, "都道府県を選択してください").max(20, "20文字以内で入力してください"),
  instagramHandle: z
    .string()
    .trim()
    .max(40, "40文字以内で入力してください")
    .regex(/^[A-Za-z0-9._]*$/, "英数字・ピリオド・アンダースコアのみ使用できます")
    .optional()
    .or(z.literal("")),
  approximatePeriod: z
    .string()
    .trim()
    .min(1, "登録したおおよその時期を入力してください")
    .max(100, "100文字以内で入力してください"),
  contactEmail: z
    .string()
    .trim()
    .min(1, "現在連絡可能なメールアドレスを入力してください")
    .email("メールアドレスの形式が正しくありません"),
  notes: z.string().trim().max(2000, "2000文字以内で入力してください").optional().or(z.literal("")),
});

export type AccountRecoveryFormValues = z.infer<typeof accountRecoverySchema>;
