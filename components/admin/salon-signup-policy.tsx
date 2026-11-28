"use client";

import { useState, useTransition } from "react";
import { setSalonSignupIssuedOnly } from "@/lib/admin/salon-signup-policy-actions";

/** サロン登録の閉鎖（認証側）の状態と切替。閉鎖中は、本部発行（招待）のアカウントだけが作られる。美容師の登録・既存サロンのログインには影響しない。 */
export function SalonSignupPolicy({ issuedOnly }: { issuedOnly: boolean | null }) {
  const [pending, start] = useTransition(); const [msg, setMsg] = useState<string | null>(null);
  if (issuedOnly === null) return <p className="mt-4 text-[12px] text-sub">登録の閉鎖設定は、まだ利用できません（準備中）。</p>;
  const next = !issuedOnly;
  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
      <p><b>サロンの新規登録（認証側）：</b>{issuedOnly ? "本部発行のみ（一般の登録は拒否）" : "一般の登録も可能（従来どおり）"}</p>
      <p className="mt-1 text-sub">美容師の新規登録と、既存サロンのログインには影響しません。切り替える前に、発行・パスワード設定メールが動作することを確認してください。</p>
      <button type="button" disabled={pending} className="mt-2 min-h-[44px] rounded-full border border-line px-4 text-[12.5px] font-semibold"
        onClick={() => { if (!window.confirm(next ? "サロンの一般登録を閉じます。本部発行のアカウントだけが作れるようになります。よろしいですか？" : "サロンの一般登録を再び開きます。よろしいですか？")) return; start(async () => { const r = await setSalonSignupIssuedOnly(next); setMsg(r.success ? "変更しました。" : r.error ?? "失敗しました。"); if (r.success) window.location.reload(); }); }}>
        {pending ? "変更中..." : next ? "一般登録を閉じる" : "一般登録を開く"}
      </button>
      {msg && <p role="status" className="mt-2 text-sub">{msg}</p>}
    </section>
  );
}
