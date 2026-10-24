"use client";

import Link from "next/link";
import { useState } from "react";
import { issueInvoiceDocumentAction } from "@/lib/invoices/actions";

type Props = {
  feeId: string;
  /** 発行済みならその書類のid。未発行は null。 */
  documentId: string | null;
};

/**
 * 請求書PDFの発行（運営者のみ）。
 * 未発行→「請求書PDFを発行」。発行済み→「発行済み」＋「PDFを確認」。二重発行はしない。
 * 不足項目はDBのコードではなく日本語で出す。
 */
export function InvoicePdfPanel({ feeId, documentId: initialDocumentId }: Props) {
  const [issued, setIssued] = useState(initialDocumentId !== null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  async function issue() {
    if (busy || issued) return;
    setMessage(null);
    setMissing([]);
    if (!window.confirm("請求書PDFを発行します。発行後は内容を変更できません。よろしいですか？")) return;
    setBusy(true);
    const result = await issueInvoiceDocumentAction(feeId);
    setBusy(false);
    if (result.success) {
      setIssued(true);
      setMessage(result.message);
    } else {
      setMessage(result.error);
      setMissing(result.missing ?? []);
    }
  }

  return (
    <section className="mt-3 rounded-xl border border-line bg-surface p-3">
      <p className="text-[11px] font-bold text-ink">請求書PDF</p>
      {issued ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-[#285B45]/10 px-3 py-1 text-[11.5px] font-bold text-[#285B45]">発行済み</span>
          {initialDocumentId ? (
            <a href={`/api/invoices/${initialDocumentId}/pdf`} target="_blank" rel="noopener noreferrer"
              className="text-[12px] font-semibold text-ink underline">PDFを確認</a>
          ) : (
            <span className="text-[11.5px] text-sub">画面を更新するとPDFを確認できます。</span>
          )}
        </div>
      ) : (
        <div className="mt-2">
          <button type="button" onClick={issue} disabled={busy}
            className="rounded-full bg-[#285B45] px-4 py-2 text-[12px] font-bold text-white disabled:opacity-50">
            {busy ? "発行しています…" : "請求書PDFを発行"}
          </button>
          <p className="mt-1 text-[10.5px] text-sub">発行時点の請求内容が固定され、後から変更できません。</p>
        </div>
      )}
      {message && <p className="mt-2 text-[12px] text-charcoal">{message}</p>}
      {missing.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[11.5px] text-[#8A2E2E]">
          {missing.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
      {missing.length > 0 && (
        <p className="mt-2 text-[11px] text-sub">
          <Link href="/admin/issuer-settings" className="underline">発行事業者の設定</Link>
          を確認してください。請求先の情報は、会社の請求先設定（会社の管理者が登録）が必要です。
        </p>
      )}
    </section>
  );
}
