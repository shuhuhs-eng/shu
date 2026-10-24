import { z } from "zod";

/**
 * 請求書PDFの元になるsnapshot（prepare_invoice_documentの戻り値）。
 * ★PDFはこのsnapshotだけから作る。他のテーブルは読み直さない。
 */
const bankSchema = z.object({
  bank_name: z.string(),
  branch_name: z.string(),
  account_type: z.string(),
  account_number: z.string(),
  account_holder: z.string(),
});

export const issuerSnapshotSchema = z.object({
  legal_name: z.string(),
  postal_code: z.string().nullable(),
  address: z.string(),
  invoice_registration_number: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  bank: bankSchema,
});

export const recipientSnapshotSchema = z.object({
  legal_name: z.string(),
  postal_code: z.string().nullable(),
  address: z.string().nullable(),
  department_name: z.string().nullable(),
  contact_name: z.string().nullable(),
});

const lineItemSchema = z.object({
  description: z.string(),
  store_name: z.string().nullable(),
  hired_date: z.string(),
  quantity: z.number(),
  unit: z.string(),
  amount: z.number(),
});

export const contentSnapshotSchema = z.object({
  invoice_number: z.string(),
  invoice_date: z.string(),
  due_date: z.string(),
  currency: z.string(),
  fee_amount: z.number(),
  tax_rate: z.number(),
  tax_amount: z.number(),
  total_amount: z.number(),
  store_name: z.string().nullable(),
  hired_date: z.string(),
  line_items: z.array(lineItemSchema).min(1),
});

export const preparedInvoiceSchema = z.object({
  issuer_snapshot: issuerSnapshotSchema,
  recipient_snapshot: recipientSnapshotSchema,
  invoice_content_snapshot: contentSnapshotSchema,
  storage_path: z.string().min(1),
  snapshot_digest: z.string().regex(/^[0-9a-f]{64}$/),
  warnings: z.array(z.string()).optional(),
});
export type PreparedInvoice = z.infer<typeof preparedInvoiceSchema>;

export const readinessSchema = z.object({
  ready: z.boolean(),
  already_issued: z.boolean(),
  historical: z.boolean(),
  missing: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type InvoiceReadiness = z.infer<typeof readinessSchema>;

export const registeredSchema = z.object({
  document_id: z.string().uuid(),
  invoice_number: z.string(),
});

export const authorizedDownloadSchema = z.object({
  document_id: z.string().uuid(),
  invoice_number: z.string(),
  storage_path: z.string().min(1),
  file_sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

/** 運営者向け・会社向けの発行済み一覧の1行（保存先パスは含まない）。 */
export const invoiceDocumentRowSchema = z.object({
  document_id: z.string().uuid(),
  success_fee_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  invoice_number: z.string(),
  generated_at: z.string(),
});
export type InvoiceDocumentRow = z.infer<typeof invoiceDocumentRowSchema>;

export const issuerSettingsSchema = z.discriminatedUnion("has_settings", [
  z.object({ has_settings: z.literal(false) }),
  z.object({
    has_settings: z.literal(true),
    legal_name: z.string().nullable(),
    postal_code: z.string().nullable(),
    address: z.string().nullable(),
    invoice_registration_number: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    bank_name: z.string().nullable(),
    bank_branch_name: z.string().nullable(),
    bank_account_type: z.string().nullable(),
    bank_account_number: z.string().nullable(),
    bank_account_holder: z.string().nullable(),
  }),
]);
export type IssuerSettings = z.infer<typeof issuerSettingsSchema>;

export const billingProfileSchema = z.discriminatedUnion("has_profile", [
  z.object({ has_profile: z.literal(false), organization_id: z.string() }),
  z.object({
    has_profile: z.literal(true),
    organization_id: z.string(),
    legal_name: z.string().nullable(),
    postal_code: z.string().nullable(),
    address: z.string().nullable(),
    department_name: z.string().nullable(),
    contact_name: z.string().nullable(),
    billing_email: z.string().nullable(),
  }),
]);
export type BillingProfile = z.infer<typeof billingProfileSchema>;

export type InvoiceActionResult =
  | { success: true; message: string }
  | { success: false; error: string; missing?: string[] };
