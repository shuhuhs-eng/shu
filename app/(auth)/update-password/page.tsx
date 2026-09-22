"use client";

import { useActionState } from "react";
import { updatePasswordAction } from "@/lib/auth/actions";
import { initialAuthActionState } from "@/lib/auth/types";
import { SubmitButton } from "@/components/auth/submit-button";
import { PendingFieldset } from "@/components/auth/pending-fieldset";
import { FormErrorBanner } from "@/components/auth/form-messages";
import { TextField } from "@/components/auth/text-field";
import { PasswordRequirementsHint } from "@/components/auth/password-requirements-hint";

export default function UpdatePasswordPage() {
  const [state, formAction] = useActionState(updatePasswordAction, initialAuthActionState);

  return (
    <div className="space-y-5">
      <h1 className="font-serif text-2xl font-bold text-ink">新しいパスワードを設定</h1>
      <p className="text-[13.5px] leading-relaxed text-charcoal">
        新しいパスワードを入力してください。設定後は再度ログインが必要です。
      </p>

      <FormErrorBanner message={state.error} />

      <form action={formAction} className="space-y-4">
        <PendingFieldset>
          <div className="space-y-4">
            <TextField
              id="password"
              name="password"
              label="新しいパスワード"
              type="password"
              autoComplete="new-password"
              errors={state.fieldErrors?.password}
            />
            <PasswordRequirementsHint />
            <TextField
              id="confirmPassword"
              name="confirmPassword"
              label="新しいパスワード（確認用）"
              type="password"
              autoComplete="new-password"
              errors={state.fieldErrors?.confirmPassword}
            />
          </div>
        </PendingFieldset>
        <SubmitButton pendingText="更新中...">パスワードを更新</SubmitButton>
      </form>
    </div>
  );
}
