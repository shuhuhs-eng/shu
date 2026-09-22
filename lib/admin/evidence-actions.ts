"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  documentId: z.string().uuid(),
  decision: z.enum(["verified", "rejected"]),
  reason: z.enum(["valid", "unrelated", "unreadable", "insufficient", "numbers_mismatch", "suspected_tampering"]),
  note: z.string().max(500).nullable(),
}).refine((v) => v.decision === "verified" ? v.reason === "valid" : v.reason !== "valid", {
  message: "判定理由を確認してください。",
});

export async function reviewEvidence(input: z.infer<typeof schema>): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "入力を確認してください。" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_stylist_evidence_document", {
    p_document_id: parsed.data.documentId,
    p_decision: parsed.data.decision,
    p_reason: parsed.data.reason,
    p_note: parsed.data.note,
  });
  if (error) {
    console.error("[reviewEvidence] RPC failed", { message: error.message, code: error.code });
    return { success: false, error: "審査結果を保存できませんでした。" };
  }
  revalidatePath("/admin/evidence");
  revalidatePath("/salon/mypage");
  return { success: true };
}

