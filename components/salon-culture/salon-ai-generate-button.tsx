"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateSalonCultureAiAction } from "@/lib/salon-culture/actions";

/** 回答済みなのにAI紹介文が無い場合の「作成する」ボタン。結果（成功・失敗・混み合い）をそのまま表示する。 */
export function SalonAiGenerateButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onClick() {
    setMessage(null);
    startTransition(async () => {
      const r = await generateSalonCultureAiAction();
      if (r.status === "generated" || r.status === "exists") {
        router.refresh();
        return;
      }
      if (r.status === "busy" || r.status === "failed") setMessage(r.error);
      else if (r.status === "unauthenticated") setMessage("セッションが切れています。再度ログインしてください。");
      else setMessage("サロンらしさの回答を完了すると、作成できます。");
    });
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-full border border-line bg-surface2 px-5 py-2.5 text-[13px] font-semibold text-ink disabled:opacity-60"
      >
        {pending ? "作成中…（数十秒かかることがあります）" : "AI紹介文を作成する"}
      </button>
      {message && (
        <p role="alert" className="mt-2 text-[12.5px] text-[#8A2E2E]">
          {message}
        </p>
      )}
    </div>
  );
}
