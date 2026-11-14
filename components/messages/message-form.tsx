"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UNKNOWN_RESULT_MESSAGE } from "@/lib/messages/shared";

type Result = { ok: true; threadId?: string } | { ok: false; error: string };
export type FormAction = (fd: FormData) => Promise<Result>;

const field = "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[16px] sm:text-[13.5px]";

/**
 * 連絡の入力フォーム（作成・運営の追加・返信で共通）。
 * ★送信IDは「保存の成功を確認するまで」同じ値を使い続ける。失敗・通信切れ・結果不明のときは、
 *   入力（件名・本文・種類）と送信IDをそのまま保持し、同じ内容で再送できる（DBが同じIDの再送を1件にまとめる）。
 * ★成功を確認した後にだけ、新しい送信IDへ切り替え、入力を空にする。
 */
export function MessageForm(props: {
  action: FormAction; initialRequestId: string; hidden: Record<string, string>;
  withSubject?: boolean; kinds?: { value: string; label: string }[]; submitLabel: string; placeholder?: string; note?: string;
  /** 作成成功後の移動先の前半（例 "/admin/messages/"）。★関数は Server→Client で渡せないため文字列で受ける。 */
  threadPathPrefix?: string;
}) {
  const router = useRouter();
  const [rid, setRid] = useState(props.initialRequestId);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState(props.kinds?.[0]?.value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData();
    for (const [k, v] of Object.entries(props.hidden)) fd.set(k, v);
    fd.set("rid", rid); fd.set("body", body);
    if (props.withSubject) fd.set("subject", subject);
    if (props.kinds) fd.set("kind", kind);
    setError(null); setUnknown(false); setDone(false);
    start(async () => {
      let res: Result;
      try { res = await props.action(fd); }
      catch { setUnknown(true); setError(UNKNOWN_RESULT_MESSAGE); return; }   // 結果不明: 送信IDも入力も保持
      if (!res.ok) { setError(res.error); return; }                          // 保存されていない（または既存の同じ送信）: 入力と送信IDを保持
      setRid(crypto.randomUUID());           // 成功を確認: 次の投稿は新しい送信ID
      setSubject(""); setBody(""); setDone(true);
      if (res.threadId && props.threadPathPrefix) router.push(`${props.threadPathPrefix}${res.threadId}`); else router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="mt-6 grid gap-3 rounded-2xl border border-line bg-surface p-4" aria-busy={pending}>
      {props.withSubject && <input value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={120} placeholder="件名" aria-label="件名" className={field} />}
      {props.kinds && (
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="種類" className={field}>
          {props.kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      )}
      <textarea value={body} onChange={(e) => setBody(e.target.value)} required maxLength={4000} rows={6} placeholder={props.placeholder ?? "本文"} aria-label="本文" className={field} />
      {error && <p role="alert" data-unknown={unknown ? "1" : "0"} className="rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12.5px] leading-relaxed text-[#8A2E2E]">{error}</p>}
      {done && <p role="status" className="rounded-lg bg-surface2 px-3 py-2 text-[12.5px] text-charcoal">送信しました。</p>}
      <button disabled={pending} className="min-h-[44px] rounded-full bg-ink px-5 text-[13px] font-semibold text-white disabled:opacity-60">
        {pending ? "送信中…" : unknown || error ? `${props.submitLabel}（同じ内容で再送）` : props.submitLabel}
      </button>
      <p className="text-[11px] leading-relaxed text-sub">{props.note ?? "二重に押しても、同じ内容は1件だけ保存されます。"}</p>
      <input type="hidden" data-testid="rid" value={rid} readOnly />
    </form>
  );
}
