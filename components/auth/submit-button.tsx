"use client";

import { useFormStatus } from "react-dom";

type Props = {
  children: React.ReactNode;
  pendingText: string;
};

/** フォーム送信中は disabled にして pendingText を表示する共通の送信ボタン。 */
export function SubmitButton({ children, pendingText }: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="flex w-full items-center justify-center gap-2 rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface transition-opacity disabled:opacity-60"
    >
      {pending ? pendingText : children}
    </button>
  );
}
