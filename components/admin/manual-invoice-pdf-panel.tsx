"use client";

import Link from "next/link";
import { useState } from "react";
import { issueManualInvoicePdfAction } from "@/lib/invoices/manual-issue-actions";

type Props = { invoiceId: string; documentId: string | null; status: "issued" | "paid" | "void"; missing: string[]; unavailable?: boolean };

/** 手動請求の請求書PDF。発行事業者・振込先・請求先が未設定の間は発行できない（不足項目を日本語で表示）。発行後は変更できない。 */
export function ManualInvoicePdfPanel({ invoiceId, documentId, status, missing: initialMissing, unavailable }: Props) {
  const [docId] = useState(documentId); const [issued, setIssued] = useState(documentId !== null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null); const [missing, setMissing] = useState<string[]>(initialMissing);
  async function issue() {
    if (busy || issued) return; setMsg(null);
    if (!window.confirm("請求書PDFを発行します。発行後は内容を変更できません。よろしいですか？")) return;
    setBusy(true); const r = await issueManualInvoicePdfAction(invoiceId); setBusy(false);
    if (r.success) { setIssued(true); setMsg(r.message); window.location.reload(); } else { setMsg(r.error); setMissing(r.missing ?? []); }
  }
  if (unavailable) return <p className="mt-2 text-[12px] text-sub">請求書PDFの発行は、まだ利用できません（準備中）。</p>;
  return (
    <div className="mt-2 text-[12.5px]">
      {issued && docId ? (<p>発行済み　<Link className="underline" href={`/api/manual-invoices/${docId}/pdf`} target="_blank">PDFを確認</Link>　<Link className="underline" href={`/api/manual-invoices/${docId}/pdf?download=1`}>ダウンロード</Link></p>)
        : status !== "issued" ? (<p className="text-sub">この請求は入金済み・取消済みのため、請求書PDFを新規に発行できません。</p>)
        : (<>
            {missing.length > 0 && (<div role="alert" className="rounded-xl bg-[#C24545]/10 p-3 text-[#8A2E2E]"><p className="font-semibold">請求書PDFを発行できません。次の項目を確認してください。</p>
              <ul className="mt-1 list-disc pl-5">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
              <p className="mt-1"><Link className="underline" href="/admin/issuer-settings">請求書の発行事業者の設定へ</Link>（請求先情報は会社ごとの請求先から登録）</p></div>)}
            <button type="button" disabled={busy || missing.length > 0} onClick={issue} className="mt-2 min-h-[44px] rounded-full bg-ink px-5 text-[13px] font-semibold text-surface disabled:opacity-40">{busy ? "発行中..." : "請求書PDFを発行"}</button>
          </>)}
      {msg && <p role="status" className="mt-2 text-sub">{msg}</p>}
    </div>
  );
}
