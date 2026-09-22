"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordResetAction } from "@/lib/auth/actions";
import { initialAuthActionState } from "@/lib/auth/types";
import { SubmitButton } from "@/components/auth/submit-button";
import { PendingFieldset } from "@/components/auth/pending-fieldset";
import { FormErrorBanner, FormSuccessBanner } from "@/components/auth/form-messages";
import { TextField } from "@/components/auth/text-field";

export default function ResetPasswordPage() {
  const [state, formAction] = useActionState(requestPasswordResetAction, initialAuthActionState);

  if (state.success) {
    return (
      <div className="space-y-5">
        <h1 className="font-serif text-2xl font-bold text-ink">メールを送信しました</h1>
        <FormSuccessBanner message={state.success} />
        <Link href="/login" className="text-[13px] text-sub underline">
          ログイン画面へ戻る
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="font-serif text-2xl font-bold text-ink">パスワード再設定</h1>
      <p className="text-[13.5px] leading-relaxed text-charcoal">
        登録済みのメールアドレスを入力してください。再設定用のリンクをお送りします。
      </p>

      <FormErrorBanner message={state.error} />

      <form action={formAction} className="space-y-4">
        <PendingFieldset>
          <TextField
            id="email"
            name="email"
            label="メールアドレス"
            type="email"
            autoComplete="email"
            errors={state.fieldErrors?.email}
          />
        </PendingFieldset>
        <SubmitButton pendingText="送信中...">再設定メールを送る</SubmitButton>
      </form>

      <Link href="/login" className="block text-[13px] text-sub underline">
        ログイン画面へ戻る
      </Link>
    </div>
  );
}
