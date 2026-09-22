"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpSalonAction } from "@/lib/auth/actions";
import { initialAuthActionState } from "@/lib/auth/types";
import { SubmitButton } from "@/components/auth/submit-button";
import { PendingFieldset } from "@/components/auth/pending-fieldset";
import { FormErrorBanner, FormSuccessBanner } from "@/components/auth/form-messages";
import { TextField } from "@/components/auth/text-field";
import { PasswordRequirementsHint } from "@/components/auth/password-requirements-hint";

/**
 * サロンアカウントの新規登録画面。app/(auth)/signup/page.tsx（美容師）と対称構造。
 * signUpSalonAction を呼ぶ点のみが差分（role: "salon" がメタデータに含まれる）。
 */
export default function SignUpSalonPage() {
  const [state, formAction] = useActionState(signUpSalonAction, initialAuthActionState);

  if (state.success) {
    return (
      <div className="space-y-5">
        <h1 className="font-serif text-2xl font-bold text-ink">確認メールを送信しました</h1>
        <FormSuccessBanner message={state.success} />
        <div className="space-y-3">
          <Link
            href="/salon/login"
            className="flex w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface"
          >
            ログインする
          </Link>
          <Link
            href="/reset-password"
            className="flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-4 text-[15px] font-semibold text-ink"
          >
            パスワードを再設定する
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="font-serif text-2xl font-bold text-ink">サロン新規登録</h1>

      <FormErrorBanner message={state.error} />

      <form action={formAction} className="space-y-4">
        <PendingFieldset>
          <div className="space-y-4">
            <TextField
              id="displayName"
              name="displayName"
              label="サロン名（後で変更できます）"
              autoComplete="organization"
              errors={state.fieldErrors?.displayName}
            />
            <TextField
              id="email"
              name="email"
              label="メールアドレス"
              type="email"
              autoComplete="email"
              errors={state.fieldErrors?.email}
            />
            <TextField
              id="password"
              name="password"
              label="パスワード"
              type="password"
              autoComplete="new-password"
              errors={state.fieldErrors?.password}
            />
            <PasswordRequirementsHint />
            <TextField
              id="confirmPassword"
              name="confirmPassword"
              label="パスワード（確認用）"
              type="password"
              autoComplete="new-password"
              errors={state.fieldErrors?.confirmPassword}
            />
          </div>
        </PendingFieldset>
        <SubmitButton pendingText="登録中...">登録する</SubmitButton>
      </form>

      <p className="text-[13px] text-sub">
        すでにアカウントをお持ちの方は{" "}
        <Link href="/salon/login" className="underline">
          ログイン
        </Link>
      </p>
      <p className="text-[13px] text-sub">
        美容師の方は{" "}
        <Link href="/signup" className="underline">
          こちら
        </Link>
      </p>
    </div>
  );
}
