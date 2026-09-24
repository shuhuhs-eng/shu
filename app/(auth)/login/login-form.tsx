"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signInAction } from "@/lib/auth/actions";
import { initialAuthActionState } from "@/lib/auth/types";
import { SubmitButton } from "@/components/auth/submit-button";
import { PendingFieldset } from "@/components/auth/pending-fieldset";
import { FormErrorBanner, FormSuccessBanner } from "@/components/auth/form-messages";
import { TextField } from "@/components/auth/text-field";

type Props = {
  /**
   * ログイン入口の役割。指定すると見出し・補助文・新規登録リンク・
   * 別入口への切り替えリンクが役割別になり、ログイン成功後の遷移先も
   * その役割専用（determineRoleEntryPath）になる。
   * 省略時（共通 /login）は従来どおりの汎用ログイン画面のまま。
   * 認証ロジック（signInAction・validation・エラーハンドリング）は
   * mode の有無に関わらず完全に同一のものを使う（複製しない）。
   */
  mode?: "stylist" | "salon";
};

const COPY = {
  stylist: {
    heading: "美容師としてログイン",
    subtext: "診断・プロフィール・スカウトを利用する",
    signupHref: "/signup",
    crossLinkHref: "/salon/login",
    crossLinkLabel: "サロンの方はこちら",
  },
  salon: {
    heading: "サロンとしてログイン",
    subtext: "採用・サロンらしさ・マッチングを利用する",
    signupHref: "/signup/salon",
    crossLinkHref: "/stylist/login",
    crossLinkLabel: "美容師の方はこちら",
  },
} as const;

export function LoginForm({ mode }: Props) {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "";
  const resetSuccess = searchParams.get("reset") === "success";
  const [state, formAction] = useActionState(signInAction, initialAuthActionState);

  // ★ログイン失敗時に入力内容が全消去される問題の修正。
  // Reactのform action（<form action={formAction}>）は、action完了後に
  // 非制御な入力をリセットしてしまう仕様のため、メール・パスワードを
  // 制御コンポーネント化し、明示的に管理する。
  //   ・メールアドレス: 失敗理由を問わず常に保持する（再入力させない）。
  //   ・パスワード: signInActionがSupabase認証自体に失敗した場合
  //     （state.errorはあるがstate.fieldErrorsが無い＝バリデーションは
  //     通ったが認証が失敗したケース）のみ空欄へ戻す。
  //     入力形式エラー（fieldErrorsあり、例: メール形式不正・未入力）の
  //     場合は、正常に入力済みのパスワードを不要に消さない。
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  useEffect(() => {
    if (state.error && !state.fieldErrors) {
      setPassword("");
    }
  }, [state]);

  const copy = mode ? COPY[mode] : null;

  return (
    <div className="space-y-5">
      <h1 className="font-serif text-2xl font-bold text-ink">{copy?.heading ?? "ログイン"}</h1>
      {copy?.subtext && <p className="text-[13.5px] text-sub">{copy.subtext}</p>}

      {resetSuccess && (
        <FormSuccessBanner message="パスワードを更新しました。新しいパスワードでログインしてください。" />
      )}
      <FormErrorBanner message={state.error} />

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        {mode && <input type="hidden" name="entryMode" value={mode} />}
        <PendingFieldset>
          <div className="space-y-4">
            <TextField
              id="email"
              name="email"
              label="メールアドレス"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              errors={state.fieldErrors?.email}
            />
            <TextField
              id="password"
              name="password"
              label="パスワード"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              errors={state.fieldErrors?.password}
            />
          </div>
        </PendingFieldset>
        <SubmitButton pendingText="ログイン中...">ログイン</SubmitButton>
      </form>

      <div className="flex items-center justify-between text-[13px] text-sub">
        <Link href="/reset-password" className="underline">
          パスワードをお忘れですか？
        </Link>
        <Link href={copy?.signupHref ?? "/signup"} className="underline">
          新規登録はこちら
        </Link>
      </div>

      {copy && (
        <p className="text-center text-[13px] text-sub">
          <Link href={copy.crossLinkHref} className="underline">
            {copy.crossLinkLabel}
          </Link>
        </p>
      )}

      <p className="mt-3 text-center text-[13px] text-sub">
        <Link href="/account-recovery" className="underline">
          登録メールアドレスが分からない方
        </Link>
      </p>
    </div>
  );
}
