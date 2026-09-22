"use client";

import { useFormStatus } from "react-dom";

/** フォーム送信中は内部の入力欄をまとめて disabled にする（見た目は display:contents で崩さない）。 */
export function PendingFieldset({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <fieldset disabled={pending} className="contents border-0 p-0 m-0">
      {children}
    </fieldset>
  );
}
