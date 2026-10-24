"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { renderInvoicePdf } from "./pdf";
import { missingLabels } from "./messages";
import {
  ensureInvoiceBucket, invoicePdfAgeMs, removeInvoicePdf, sha256Hex, uploadInvoicePdf,
} from "./storage";
import {
  billingProfileSchema, invoiceDocumentRowSchema, issuerSettingsSchema, preparedInvoiceSchema,
  readinessSchema, registeredSchema,
  type BillingProfile, type InvoiceActionResult, type InvoiceDocumentRow, type IssuerSettings,
} from "./types";

/** 作りかけのファイルとみなす経過時間（これより新しい同名ファイルは「発行中」の可能性があるため消さない）。 */
const ORPHAN_AGE_MS = 10 * 60 * 1000;

const GENERIC_ISSUE_ERROR = "請求書PDFを発行できませんでした。時間をおいて再度お試しください。";

function revalidateInvoicePages() {
  revalidatePath("/admin/success-fees");
  revalidatePath("/admin/companies");
  revalidatePath("/salon/company/billing");
}

/** 運営者向け：発行済み請求書PDFの一覧。失敗時は null。 */
export async function getAdminInvoiceDocuments(): Promise<InvoiceDocumentRow[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_invoice_documents", { p_organization_id: null });
  if (error) {
    console.error("[getAdminInvoiceDocuments] RPC failed", { message: error.message, code: error.code });
    return null;
  }
  const parsed = z.array(invoiceDocumentRowSchema.passthrough()).safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** 会社向け：自社の発行済み請求書PDFの一覧（保存先・hashは返らない）。失敗時は null。 */
export async function getCompanyInvoiceDocuments(): Promise<InvoiceDocumentRow[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_company_invoice_documents", { p_organization_id: null });
  if (error) {
    console.error("[getCompanyInvoiceDocuments] RPC failed", { message: error.message, code: error.code });
    return null;
  }
  const parsed = z.array(invoiceDocumentRowSchema.passthrough()).safeParse(data);
  return parsed.success ? parsed.data : null;
}

/**
 * 請求書PDFを発行する（運営者のみ）。順序は固定：
 *   readiness → prepare → snapshotからPDF生成 → SHA-256 → privateへupload → register
 *   → （register失敗時のみ）uploadしたファイルを削除。
 * ★registerが成功した後は、画面側の問題があっても発行済みとして扱う（再発行しない）。
 */
export async function issueInvoiceDocumentAction(feeId: string): Promise<InvoiceActionResult> {
  if (!z.string().uuid().safeParse(feeId).success) return { success: false, error: "入力内容を確認してください。" };
  const supabase = await createClient();

  // 1. 発行できる状態か。
  const { data: readinessRaw, error: readinessError } = await supabase.rpc("get_invoice_issue_readiness", { p_success_fee_id: feeId });
  if (readinessError) {
    console.error("[issueInvoice] readiness failed", { message: readinessError.message, code: readinessError.code });
    return { success: false, error: readinessError.message.includes("admin access required") ? "この操作は運営者のみ行えます。" : GENERIC_ISSUE_ERROR };
  }
  const readiness = readinessSchema.safeParse(readinessRaw);
  if (!readiness.success) return { success: false, error: GENERIC_ISSUE_ERROR };
  if (readiness.data.already_issued) {
    revalidateInvoicePages();
    return { success: true, message: "この請求書はすでに発行済みです。" };
  }
  if (!readiness.data.ready) {
    return { success: false, error: "請求書を発行するために、次の項目を確認してください。", missing: missingLabels(readiness.data.missing) };
  }

  // 2. 固定されたsnapshotを受け取る。
  const { data: preparedRaw, error: prepareError } = await supabase.rpc("prepare_invoice_document", { p_success_fee_id: feeId });
  if (prepareError) {
    console.error("[issueInvoice] prepare failed", { message: prepareError.message, code: prepareError.code });
    return { success: false, error: GENERIC_ISSUE_ERROR };
  }
  const prepared = preparedInvoiceSchema.safeParse(preparedRaw);
  if (!prepared.success) {
    console.error("[issueInvoice] unexpected snapshot shape");
    return { success: false, error: GENERIC_ISSUE_ERROR };
  }

  // 3. snapshotだけからPDFを作り、そのbytesのSHA-256を計算する。
  let bytes: Uint8Array;
  try {
    bytes = await renderInvoicePdf(prepared.data);
  } catch (e) {
    console.error("[issueInvoice] render failed", { message: e instanceof Error ? e.message : "unknown" });
    return { success: false, error: "請求書PDFを作成できませんでした。時間をおいて再度お試しください。" };
  }
  const sha = sha256Hex(bytes);
  const path = prepared.data.storage_path;

  // 4. privateのbucketへ保存する（DBが指定したパス・上書きなし）。
  if (!(await ensureInvoiceBucket())) return { success: false, error: "請求書の保存先を準備できませんでした。" };
  let upload = await uploadInvoicePdf(path, bytes);
  if (!upload.ok && upload.conflict) {
    // 同じパスにファイルがある。DBに発行記録が無い（上のreadinessで確認済み）ので、
    // 以前の失敗で残った作りかけの可能性がある。十分古い場合だけ消して1回やり直す。
    const age = await invoicePdfAgeMs(path);
    if (age !== null && age > ORPHAN_AGE_MS) {
      await removeInvoicePdf(path);
      upload = await uploadInvoicePdf(path, bytes);
    } else {
      return { success: false, error: "この請求書は別の操作で発行中の可能性があります。しばらくしてから画面を更新してください。" };
    }
  }
  if (!upload.ok) return { success: false, error: "請求書PDFを保存できませんでした。時間をおいて再度お試しください。" };

  // 5. 発行を記録する。
  const { data: registeredRaw, error: registerError } = await supabase.rpc("register_invoice_document", {
    p_success_fee_id: feeId,
    p_snapshot_digest: prepared.data.snapshot_digest,
    p_file_sha256: sha,
  });
  if (registerError || !registeredSchema.safeParse(registeredRaw).success) {
    console.error("[issueInvoice] register failed", { message: registerError?.message, code: registerError?.code });
    // 通信エラー等で「実は記録されていた」場合にファイルを消さないよう、記録の有無を確かめてから後始末する。
    const { data: after } = await supabase.rpc("get_invoice_issue_readiness", { p_success_fee_id: feeId });
    const issued = readinessSchema.safeParse(after);
    if (issued.success && issued.data.already_issued) {
      revalidateInvoicePages();
      return { success: true, message: "請求書PDFを発行しました。" };
    }
    await removeInvoicePdf(path);
    const changed = registerError?.message.includes("snapshot has changed");
    return {
      success: false,
      error: changed ? "請求内容が変更されたため発行できませんでした。画面を更新してもう一度お試しください。" : GENERIC_ISSUE_ERROR,
    };
  }

  revalidateInvoicePages();
  return { success: true, message: "請求書PDFを発行しました。" };
}

// ---------------- 発行事業者設定（運営者のみ） ----------------

export async function getIssuerSettings(): Promise<IssuerSettings | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_billing_issuer_settings");
  if (error) {
    console.error("[getIssuerSettings] RPC failed", { message: error.message, code: error.code });
    return null;
  }
  const parsed = issuerSettingsSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

const optionalText = (max: number) => z.string().max(max);
const issuerInputSchema = z.object({
  legal_name: optionalText(200),
  postal_code: optionalText(20),
  address: optionalText(300),
  invoice_registration_number: optionalText(40),
  phone: optionalText(40),
  email: optionalText(200),
  bank_name: optionalText(100),
  bank_branch_name: optionalText(100),
  bank_account_type: z.enum(["", "ordinary", "checking", "savings"]),
  bank_account_number: optionalText(20),
  bank_account_holder: optionalText(100),
});
export type IssuerSettingsInput = z.infer<typeof issuerInputSchema>;

function issuerFriendlyError(message: string): string {
  if (message.includes("admin access required")) return "この操作は運営者のみ行えます。";
  if (message.includes("invalid email")) return "メールアドレスの形式を確認してください。";
  if (message.includes("invalid bank account number")) return "口座番号は数字で入力してください。";
  if (message.includes("registration number")) return "インボイス登録番号の形式を確認してください（T＋13桁の数字）。";
  if (message.includes("postal")) return "郵便番号の形式を確認してください。";
  if (message.includes("too long")) return "入力が長すぎる項目があります。";
  return "保存できませんでした。入力内容を確認してください。";
}

/** 送られた全項目を保存する（空欄は未登録に戻す）。正規化・検証はDBに任せる。 */
export async function saveIssuerSettingsAction(input: IssuerSettingsInput): Promise<InvoiceActionResult> {
  const parsed = issuerInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "入力内容を確認してください。" };
  const changes: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(parsed.data)) changes[k] = v.trim() === "" ? null : v.trim();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_billing_issuer_settings", { p_changes: changes, p_reason: null });
  if (error) {
    console.error("[saveIssuerSettings] RPC failed", { message: error.message, code: error.code });
    return { success: false, error: issuerFriendlyError(error.message) };
  }
  revalidatePath("/admin/issuer-settings");
  return { success: true, message: "保存しました。" };
}

// ---------------- 会社の請求先（company_owner / company_admin） ----------------

export async function getBillingProfile(organizationId: string): Promise<BillingProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_organization_billing_profile", { p_organization_id: organizationId });
  if (error) {
    console.error("[getBillingProfile] RPC failed", { message: error.message, code: error.code });
    return null;
  }
  const parsed = billingProfileSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

const profileInputSchema = z.object({
  organizationId: z.string().uuid(),
  legal_name: optionalText(200),
  postal_code: optionalText(20),
  address: optionalText(300),
  department_name: optionalText(100),
  contact_name: optionalText(100),
  billing_email: optionalText(200),
});
export type BillingProfileInput = z.infer<typeof profileInputSchema>;

/** 会社名・住所の3項目は必須（空欄で消せない）。その他は空欄で未登録に戻る。 */
export async function saveBillingProfileAction(input: BillingProfileInput): Promise<InvoiceActionResult> {
  const parsed = profileInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "入力内容を確認してください。" };
  const { organizationId, ...fields } = parsed.data;
  if (!fields.legal_name.trim() || !fields.postal_code.trim() || !fields.address.trim()) {
    return { success: false, error: "正式名称・郵便番号・住所は必須です。" };
  }
  const changes: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(fields)) changes[k] = v.trim() === "" ? null : v.trim();
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_organization_billing_profile", { p_organization_id: organizationId, p_changes: changes });
  if (error) {
    console.error("[saveBillingProfile] RPC failed", { message: error.message, code: error.code });
    const m = error.message;
    if (m.includes("not accessible")) return { success: false, error: "この操作を行う権限がありません。" };
    if (m.includes("invalid email")) return { success: false, error: "メールアドレスの形式を確認してください。" };
    if (m.includes("postal")) return { success: false, error: "郵便番号の形式を確認してください。" };
    if (m.includes("too long")) return { success: false, error: "入力が長すぎる項目があります。" };
    return { success: false, error: "保存できませんでした。入力内容を確認してください。" };
  }
  revalidatePath("/salon/company/billing-profile");
  revalidatePath("/salon/company/billing");
  return { success: true, message: "保存しました。" };
}
