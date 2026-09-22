"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { EvidenceType } from "@/lib/match-profile/evidence-options";
import type { Database } from "@/types/database";

type EvidenceRow = Database["public"]["Tables"]["stylist_evidence_documents"]["Row"];

const registerSchema = z.object({
  documentType: z.enum(["pos_sales", "payslip", "performance_report", "other"]),
  storagePath: z.string().min(1).max(500),
  originalFileName: z.string().trim().min(1).max(180),
});

export async function registerEvidenceDocument(input: {
  documentType: EvidenceType;
  storagePath: string;
  originalFileName: string;
}): Promise<{ success: true; document: EvidenceRow } | { success: false; error: string }> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "資料の内容を確認してください。" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_stylist_evidence_document", {
    p_document_type: parsed.data.documentType,
    p_storage_path: parsed.data.storagePath,
    p_original_file_name: parsed.data.originalFileName,
  });
  if (error || !data) {
    console.error("[registerEvidenceDocument] RPC failed", { message: error?.message, code: error?.code });
    await supabase.storage.from("stylist-evidence").remove([parsed.data.storagePath]);
    return { success: false, error: "資料を登録できませんでした。もう一度お試しください。" };
  }
  return { success: true, document: data };
}

export async function deleteEvidenceDocument(documentId: string, storagePath: string): Promise<{
  success: true;
} | { success: false; error: string }> {
  if (!z.string().uuid().safeParse(documentId).success || !storagePath) {
    return { success: false, error: "削除対象を確認できませんでした。" };
  }
  const supabase = await createClient();
  const { data: registeredPath, error } = await supabase.rpc("delete_stylist_evidence_document", {
    p_document_id: documentId,
  });
  if (error || !registeredPath || registeredPath !== storagePath) {
    console.error("[deleteEvidenceDocument] RPC failed", { message: error?.message, code: error?.code });
    return { success: false, error: "資料を削除できませんでした。" };
  }
  const { error: storageError } = await supabase.storage.from("stylist-evidence").remove([registeredPath]);
  if (storageError) console.error("[deleteEvidenceDocument] storage cleanup failed", storageError);
  return { success: true };
}
