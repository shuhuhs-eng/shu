"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyValuePrioritiesAction } from "@/lib/profile/apply-values-actions";

/**
 * 「プロフィールに反映する」ボタン（本人が押したときだけ保存。自動では保存しない）。
 * 更新されるのは「サロン選びで大切にしたいこと」だけ（専用関数 set_stylist_value_priorities）。ほかのプロフィール項目は更新されない。
 * 失敗したときは成功と表示せず、画面の「現在の設定」も変えない。
 */
export function ApplyValuesButton({ proposed, disabledReason }: { proposed: string[]; disabledReason: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const disabled = pending || !!disabledReason;
  return (
    <div className="mt-4">
      <button
        type="button" disabled={disabled} aria-disabled={disabled} data-testid="apply-button"
        onClick={() => { setMsg(null); start(async () => {
          const r = await applyValuePrioritiesAction(proposed);
          if (r.ok) { setMsg({ ok: true, text: "プロフィールに反映しました。" }); router.refresh(); } else setMsg({ ok: false, text: r.message });
        }); }}
        className={`flex min-h-[48px] w-full items-center justify-center rounded-full px-6 py-3 text-[14px] font-semibold ${disabled ? "cursor-not-allowed border border-line bg-surface2 text-sub opacity-70" : "bg-ink text-surface"}`}
      >
        {pending ? "反映しています…" : "プロフィールに反映する"}
      </button>
      {disabledReason && <p className="mt-2 text-[12.5px] leading-relaxed text-charcoal" data-testid="apply-disabled-reason">{disabledReason}</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} data-testid="apply-result" className={`mt-2 text-[12.5px] leading-relaxed ${msg.ok ? "text-[#1F6B61]" : "text-[#8A2E2E]"}`}>{msg.text}</p>}
    </div>
  );
}
