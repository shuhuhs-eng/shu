"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpAction } from "@/lib/auth/actions";
import { initialAuthActionState } from "@/lib/auth/types";
import { SubmitButton } from "@/components/auth/submit-button";
import { PendingFieldset } from "@/components/auth/pending-fieldset";
import { FormErrorBanner, FormSuccessBanner } from "@/components/auth/form-messages";
import { TextField } from "@/components/auth/text-field";
import { PasswordRequirementsHint } from "@/components/auth/password-requirements-hint";

export default function SignUpPage() {
  const [state, formAction] = useActionState(signUpAction, initialAuthActionState);

  if (state.success) {
    return (
      <div className="space-y-5">
        <h1 className="font-serif text-2xl font-bold text-ink">確認メールを送信しました</h1>
        <FormSuccessBanner message={state.success} />
        <div className="space-y-3">
          <Link
            href="/stylist/login"
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
      <h1 className="font-serif text-2xl font-bold text-ink">新規登録</h1>

      <FormErrorBanner message={state.error} />

      <form action={formAction} className="space-y-4">
        <PendingFieldset>
          <div className="space-y-4">
            <TextField
              id="displayName"
              name="displayName"
              label="表示名"
              autoComplete="nickname"
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
        <Link href="/stylist/login" className="underline">
          ログイン
        </Link>
      </p>
    </div>
  );
}
