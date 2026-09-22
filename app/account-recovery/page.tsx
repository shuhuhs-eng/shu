"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { TextField } from "@/components/auth/text-field";
import { SelectField } from "@/components/profile/select-field";
import { TextareaField } from "@/components/profile/textarea-field";
import { FormErrorBanner, FormSuccessBanner } from "@/components/auth/form-messages";
import { PREFECTURES } from "@/lib/validation/profile-options";

const ACCOUNT_TYPE_OPTIONS = [
  { value: "stylist", label: "美容師" },
  { value: "salon", label: "サロン" },
];

/**
 * 「登録メールアドレスが分からない方」向けの問い合わせフォーム。
 *
 * ★このページ・APIともにアカウントの存在確認機能は持たない。入力内容を
 * そのまま保存するだけで、既存アカウントとの照合結果を画面に出すことは無い
 * （送信後の表示は常に同じ文言）。詳細は app/api/account-recovery/route.ts
 * のコメントを参照。
 */
export default function AccountRecoveryPage() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(undefined);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    const payload = {
      displayName: formData.get("displayName"),
      accountType: formData.get("accountType"),
      salonName: formData.get("salonName"),
      prefecture: formData.get("prefecture"),
      instagramHandle: formData.get("instagramHandle"),
      approximatePeriod: formData.get("approximatePeriod"),
      contactEmail: formData.get("contactEmail"),
      notes: formData.get("notes"),
    };

    try {
      const res = await fetch("/api/account-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.fieldErrors) {
          setFieldErrors(data.fieldErrors);
          setError("入力内容をご確認ください。");
        } else {
          setError("送信に失敗しました。しばらくしてから再度お試しください。");
        }
        setSubmitting(false);
        return;
      }

      setSuccess(true);
    } catch {
      setError("送信に失敗しました。しばらくしてから再度お試しください。");
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <main className="mx-auto max-w-[560px] px-5 py-12">
        <div className="mb-7 flex items-center gap-2.5">
          <span className="eyebrow">Beauty Reach</span>
          <hr className="h-px flex-1 border-0 bg-line" />
        </div>
        <h1 className="font-serif text-2xl font-bold text-ink">送信しました</h1>
        <FormSuccessBanner message="内容を確認のうえ、本人確認ができた場合に限り、入力された連絡先へご案内します。" />
        <Link href="/login" className="mt-5 inline-block text-[13px] font-semibold text-ink underline">
          ログイン画面へ戻る
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <h1 className="font-serif text-2xl font-bold text-ink">登録メールアドレスが分からない方</h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-charcoal">
        以下の情報をご入力ください。内容を確認のうえ、本人確認ができた場合に限り、ご案内いたします。
        このフォームでアカウントの有無をその場でお調べすることはできません。
      </p>

      <FormErrorBanner message={error} />

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <fieldset disabled={submitting} className="contents border-0 p-0 m-0">
          <TextField
            id="displayName"
            name="displayName"
            label="登録時の表示名"
            errors={fieldErrors.displayName}
          />
          <SelectField
            id="accountType"
            name="accountType"
            label="アカウント種別"
            placeholder="選択してください"
            options={ACCOUNT_TYPE_OPTIONS}
            errors={fieldErrors.accountType}
          />
          <TextField
            id="salonName"
            name="salonName"
            label="所属サロン名"
            errors={fieldErrors.salonName}
          />
          <SelectField
            id="prefecture"
            name="prefecture"
            label="都道府県"
            placeholder="選択してください"
            options={PREFECTURES.map((p) => ({ value: p, label: p }))}
            errors={fieldErrors.prefecture}
          />
          <TextField
            id="instagramHandle"
            name="instagramHandle"
            label="Instagramアカウント（任意・@なし）"
            required={false}
            errors={fieldErrors.instagramHandle}
          />
          <TextField
            id="approximatePeriod"
            name="approximatePeriod"
            label="登録したおおよその時期"
            errors={fieldErrors.approximatePeriod}
          />
          <TextField
            id="contactEmail"
            name="contactEmail"
            label="現在連絡可能なメールアドレス"
            type="email"
            autoComplete="email"
            errors={fieldErrors.contactEmail}
          />
          <TextareaField
            id="notes"
            name="notes"
            label="補足内容（任意）"
            required={false}
            maxLength={2000}
            errors={fieldErrors.notes}
          />
        </fieldset>

        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface transition-opacity disabled:opacity-60"
        >
          {submitting ? "送信中..." : "送信する"}
        </button>
      </form>

      <Link href="/login" className="mt-5 block text-[13px] text-sub underline">
        ログイン画面へ戻る
      </Link>
    </main>
  );
}
