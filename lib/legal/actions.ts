"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getLegalOperatorInfo, isLegalOperatorInfoComplete } from "./config";
import { LEGAL_DOCUMENTS } from "./documents";
import { safeNextPath } from "./gate";
import { buildLegalSnapshot, serializeLegalSnapshot } from "./snapshot";
import { acceptanceStatusSchema, adminLegalDocumentSchema, currentLegalDocumentSchema, legalTypeSchema } from "./types";
import type { AcceptanceStatus, AdminLegalDocument, CurrentLegalDocument, LegalActionResult } from "./types";

/** 自分の同意状況。失敗時は null。 */
export async function getMyLegalAcceptanceStatus(): Promise<AcceptanceStatus | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_legal_acceptance_status");
  if (error) {
    console.error("[getMyLegalAcceptanceStatus] RPC failed", { message: error.message, code: error.code });
    return null;
  }
  const parsed = acceptanceStatusSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** 現在公開中の版（本文snapshot付き）。未ログインでも読める。失敗時は null、公開なしは空配列。 */
export async function getCurrentLegalDocuments(): Promise<CurrentLegalDocument[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_current_legal_documents");
  if (error) {
    console.error("[getCurrentLegalDocuments] RPC failed", { message: error.message, code: error.code });
    return null;
  }
  const parsed = z.array(currentLegalDocumentSchema).safeParse(data);
  return parsed.success ? parsed.data : null;
}

/**
 * 同意する。送る内容は、DBが「未同意の現在の版」として返したもの（document_id・版・ハッシュ）。
 * 画面を開いたあとに版が更新されていれば、DBが拒否する（古い画面での誤った同意を防ぐ）。
 */
export async function acceptLegalDocumentsAction(next: string): Promise<LegalActionResult> {
  const status = await getMyLegalAcceptanceStatus();
  if (!status) return { success: false, error: "同意を記録できませんでした。時間をおいて再度お試しください。" };
  if (!status.accepted) {
    const supabase = await createClient();
    const { error } = await supabase.rpc("accept_legal_documents", {
      p_documents: status.pending.map((p) => ({
        document_id: p.document_id,
        document_type: p.document_type,
        version: p.version,
        content_hash: p.content_hash,
      })),
    });
    if (error) {
      console.error("[acceptLegalDocuments] RPC failed", { message: error.message, code: error.code });
      return {
        success: false,
        error: error.message.includes("have changed")
          ? "規約の内容が更新されています。画面を更新してから、もう一度ご確認ください。"
          : "同意を記録できませんでした。時間をおいて再度お試しください。",
      };
    }
  }
  redirect(safeNextPath(next));
}

// ---------------- 運営者（版の公開・過去版の確認） ----------------

export async function getAdminLegalDocuments(): Promise<AdminLegalDocument[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_legal_documents");
  if (error) {
    console.error("[getAdminLegalDocuments] RPC failed", { message: error.message, code: error.code });
    return null;
  }
  const parsed = z.array(adminLegalDocumentSchema).safeParse(data);
  return parsed.success ? parsed.data : null;
}

/**
 * コードの本文に、現在の運営者情報（環境設定）と施行日を入れた「完成した本文」を、公開版として不変保存する。
 * ハッシュはDBが保存した本文から計算する。運営者情報が未設定のときは公開しない。
 */
export async function publishLegalDocumentAction(input: { type: string; effectiveDate: string }): Promise<LegalActionResult> {
  const type = legalTypeSchema.safeParse(input.type);
  if (!type.success || !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) {
    return { success: false, error: "入力内容を確認してください。" };
  }
  const operator = getLegalOperatorInfo();
  if (!isLegalOperatorInfoComplete(operator)) {
    return { success: false, error: "運営者の名称・所在地・問い合わせ先の設定が未完了のため、公開できません。" };
  }
  const doc = LEGAL_DOCUMENTS[type.data];
  const snapshot = buildLegalSnapshot(doc, operator, input.effectiveDate);
  if (!snapshot) return { success: false, error: "公開する本文を作成できませんでした。" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_publish_legal_document", {
    p_document_type: doc.type,
    p_version: doc.version,
    p_title: doc.title,
    p_content_snapshot: serializeLegalSnapshot(snapshot),
    p_effective_at: `${input.effectiveDate}T00:00:00+09:00`,
  });
  if (error) {
    console.error("[publishLegalDocument] RPC failed", { message: error.message, code: error.code });
    if (error.message.includes("already published")) {
      return { success: false, error: "この版はすでに公開されています。本文を変更した場合は、版を上げてから公開してください。" };
    }
    if (error.message.includes("admin access required")) return { success: false, error: "この操作は運営者のみ行えます。" };
    return { success: false, error: "公開できませんでした。時間をおいて再度お試しください。" };
  }
  revalidatePath("/admin/legal");
  revalidatePath("/terms");
  revalidatePath("/privacy");
  return { success: true, message: "公開しました。施行日以降、ユーザーに同意を求めます。" };
}

export type LegalPublishPreview =
  | { success: true; title: string; version: string; effectiveDate: string; hash: string }
  | { success: false; error: string };

/**
 * 公開確認ダイアログ用：これから公開される本文のハッシュを事前に計算して返す（DB変更なし）。
 * DBは保存本文のSHA-256（UTF-8）をcontent_hashとして保存するため、同じ計算で一致する。
 * 運営者のみ。
 */
export async function previewLegalPublishAction(input: { type: string; effectiveDate: string }): Promise<LegalPublishPreview> {
  const type = legalTypeSchema.safeParse(input.type);
  if (!type.success || !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) {
    return { success: false, error: "入力内容を確認してください。" };
  }
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) return { success: false, error: "この操作は運営者のみ行えます。" };

  const operator = getLegalOperatorInfo();
  if (!isLegalOperatorInfoComplete(operator)) {
    return { success: false, error: "運営者の名称・所在地・問い合わせ先の設定が未完了のため、公開できません。" };
  }
  const doc = LEGAL_DOCUMENTS[type.data];
  const snapshot = buildLegalSnapshot(doc, operator, input.effectiveDate);
  if (!snapshot) return { success: false, error: "公開する本文を作成できませんでした。" };
  const hash = createHash("sha256").update(serializeLegalSnapshot(snapshot), "utf8").digest("hex");
  return { success: true, title: doc.title, version: doc.version, effectiveDate: input.effectiveDate, hash };
}
