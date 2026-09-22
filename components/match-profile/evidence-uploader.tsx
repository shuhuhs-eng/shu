"use client";

import { useState, type ChangeEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  deleteEvidenceDocument,
  registerEvidenceDocument,
} from "@/lib/match-profile/evidence-actions";
import { EVIDENCE_TYPES, type EvidenceType } from "@/lib/match-profile/evidence-options";
import type { Database } from "@/types/database";

type EvidenceRow = Database["public"]["Tables"]["stylist_evidence_documents"]["Row"];
const MAX_FILES = 5;
const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const REVIEW_LABELS: Record<string, string> = {
  submitted: "確認中", verified: "資料一致", rejected: "再提出が必要",
};
const REASON_LABELS: Record<string, string> = {
  unrelated: "実績と関係のない資料です。",
  unreadable: "不鮮明で内容を読み取れません。",
  insufficient: "確認に必要な情報が不足しています。",
  numbers_mismatch: "申告した数字と資料の内容が一致しません。",
  suspected_tampering: "加工の可能性があるため別の資料が必要です。",
};

export function EvidenceUploader({ userId, initialDocuments }: {
  userId: string;
  initialDocuments: EvidenceRow[];
}) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [documentType, setDocumentType] = useState<EvidenceType>("pos_sales");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (documents.length >= MAX_FILES) return setError("資料は5件まで登録できます。");
    if (!ALLOWED_TYPES.includes(file.type)) return setError("PDF・JPEG・PNGを選択してください。");
    if (file.size > MAX_SIZE) return setError("1件10MB以下の資料を選択してください。");

    setBusy(true);
    const extension = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";
    const path = `${userId}/${documentType}/${crypto.randomUUID()}.${extension}`;
    const supabase = createClient();
    const { error: uploadError } = await supabase.storage.from("stylist-evidence").upload(path, file, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) {
      setBusy(false);
      return setError("アップロードに失敗しました。もう一度お試しください。");
    }
    const result = await registerEvidenceDocument({ documentType, storagePath: path, originalFileName: file.name });
    setBusy(false);
    if (!result.success) return setError(result.error);
    setDocuments((current) => [...current, result.document]);
  }

  async function remove(document: EvidenceRow) {
    setBusy(true);
    setError(null);
    const result = await deleteEvidenceDocument(document.id, document.storage_path);
    setBusy(false);
    if (!result.success) return setError(result.error);
    setDocuments((current) => current.filter((item) => item.id !== document.id));
  }

  return <section id="evidence" className="mt-8 rounded-2xl border border-line bg-surface p-5">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="eyebrow mb-1">実績確認</p>
        <h2 className="font-serif text-lg font-bold text-ink">証明資料を提出する</h2>
      </div>
      <span className="rounded-full bg-surface2 px-3 py-1 text-[11px] font-semibold text-sub">{documents.length} / {MAX_FILES}件</span>
    </div>
    <p className="mt-2 text-[12px] leading-relaxed text-sub">サロンには資料そのものを公開しません。氏名・店舗名・顧客名は黒塗りで提出できます。</p>
    {error && <p role="alert" className="mt-3 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">{error}</p>}

    {documents.length > 0 && <div className="mt-4 space-y-2">{documents.map((document) => <div key={document.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface2 px-3 py-3">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-charcoal">{EVIDENCE_TYPES.find((item) => item.code === document.document_type)?.label ?? "証明資料"}</p>
        <p className="truncate text-[11px] text-sub">{document.original_file_name}</p>
        <p className={`mt-1 text-[10.5px] font-semibold ${document.review_status === "rejected" ? "text-[#8A2E2E]" : document.review_status === "verified" ? "text-[#285B45]" : "text-sub"}`}>{REVIEW_LABELS[document.review_status] ?? document.review_status}</p>
        {document.review_status === "rejected" && document.review_reason && <p className="mt-1 text-[10.5px] leading-relaxed text-[#8A2E2E]">{REASON_LABELS[document.review_reason] ?? "資料を確認して再提出してください。"}</p>}
        {document.review_note && <p className="mt-1 text-[10.5px] leading-relaxed text-sub">確認メモ: {document.review_note}</p>}
      </div>
      <button type="button" disabled={busy} onClick={() => remove(document)} className="shrink-0 text-[11px] text-sub underline disabled:opacity-50">削除</button>
    </div>)}</div>}

    {documents.length < MAX_FILES && <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
      <select value={documentType} onChange={(e) => setDocumentType(e.target.value as EvidenceType)} disabled={busy} className="rounded-xl border border-line bg-surface px-3 py-3 text-[13px] text-ink">
        {EVIDENCE_TYPES.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}
      </select>
      <label className={`rounded-full bg-ink px-5 py-3 text-center text-[13px] font-semibold text-surface ${busy ? "opacity-60" : "cursor-pointer"}`}>
        {busy ? "処理中..." : "資料を選ぶ"}
        <input type="file" accept="application/pdf,image/jpeg,image/png" disabled={busy} onChange={upload} className="hidden" />
      </label>
    </div>}
  </section>;
}
