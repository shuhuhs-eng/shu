import { z } from "zod";

/**
 * パスワードルール（美容師/サロン新規登録・パスワード更新で共通）。
 * ・8文字以上
 * ・半角英字を1文字以上含む
 * ・半角数字を1文字以上含む
 *
 * 1つの正規表現で丸ごと判定するのではなく、条件ごとに独立してチェックし、
 * それぞれ専用の日本語エラーメッセージを出す（superRefineは該当する条件の
 * 数だけissueを追加するため、複数条件を同時に満たさない場合は複数件表示される）。
 * Supabase Auth側にも同条件のパスワードポリシーを設定する前提（README/
 * docs/integration-test-plan.md参照）。ここでのzod検証はその手前のクライアント
 * 側の一次防御であり、Supabase側のエラーは lib/auth/errors.ts で別途日本語化する。
 */
const passwordRule = z.string().superRefine((value, ctx) => {
  if (value.length < 8) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "パスワードは8文字以上で入力してください" });
  }
  if (!/[A-Za-z]/.test(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "パスワードには英字を1文字以上含めてください" });
  }
  if (!/[0-9]/.test(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "パスワードには数字を1文字以上含めてください" });
  }
});

export const signUpSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, "表示名を入力してください")
      .max(40, "表示名は40文字以内で入力してください"),
    email: z.string().trim().min(1, "メールアドレスを入力してください").email("メールアドレスの形式が正しくありません"),
    password: passwordRule,
    confirmPassword: z.string().min(1, "確認用パスワードを入力してください"),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "パスワードが一致しません",
    path: ["confirmPassword"],
  });

export const loginSchema = z.object({
  email: z.string().trim().min(1, "メールアドレスを入力してください").email("メールアドレスの形式が正しくありません"),
  password: z.string().min(1, "パスワードを入力してください"),
});

export const requestResetSchema = z.object({
  email: z.string().trim().min(1, "メールアドレスを入力してください").email("メールアドレスの形式が正しくありません"),
});

export const updatePasswordSchema = z
  .object({
    password: passwordRule,
    confirmPassword: z.string().min(1, "確認用パスワードを入力してください"),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "パスワードが一致しません",
    path: ["confirmPassword"],
  });
