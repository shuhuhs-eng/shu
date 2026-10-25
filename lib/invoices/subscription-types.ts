import { z } from "zod";

/**
 * 月額（カード決済済み）の適格請求書PDFの元になるsnapshot（0049 prepare系RPCの戻り値）。
 * ★PDFはこのsnapshotだけから作る。振込先は無い。カード番号等は存在しない。
 */
export const subscriptionIssuerSchema = z.object({
  legal_name: z.string(),
  postal_code: z.string().nullable(),
  address: z.string(),
  invoice_registration_number: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
});
export const subscriptionRecipientSchema = z.object({
  legal_name: z.string(),
  postal_code: z.string().nullable(),
  address: z.string().nullable(),
  department_name: z.string().nullable(),
  contact_name: z.string().nullable(),
});
export const subscriptionContentSchema = z.object({
  document_kind: z.literal("subscription_card"),
  invoice_number: z.string(),
  invoice_date: z.string(),
  transaction_date: z.string(),
  service_period_start: z.string(),
  service_period_end: z.string(),
  currency: z.string(),
  amount_excl_tax: z.number(),
  tax_rate: z.number(),
  tax_amount: z.number(),
  total_amount: z.number(),
  line_items: z.array(z.object({
    description: z.string(), quantity: z.number(), unit: z.string(), amount: z.number(),
  })).min(1),
  payment: z.object({
    method: z.literal("credit_card"),
    status: z.literal("paid"),
    paid_at: z.string(),
    stripe_invoice_id: z.string(),
    stripe_payment_intent_id: z.string().nullable(),
  }),
});
export const preparedSubscriptionInvoiceSchema = z.object({
  issuer_snapshot: subscriptionIssuerSchema,
  recipient_snapshot: subscriptionRecipientSchema,
  invoice_content_snapshot: subscriptionContentSchema,
  storage_path: z.string().min(1),
  snapshot_digest: z.string().regex(/^[0-9a-f]{64}$/),
  warnings: z.array(z.string()).optional(),
});
export type PreparedSubscriptionInvoice = z.infer<typeof preparedSubscriptionInvoiceSchema>;

export const subscriptionPrepareResultSchema = z.discriminatedUnion("result", [
  z.object({ result: z.literal("already_issued") }),
  z.object({ result: z.literal("not_ready"), missing: z.array(z.string()) }),
  preparedSubscriptionInvoiceSchema.extend({ result: z.literal("ready") }).passthrough(),
]);

export const subscriptionRegisteredSchema = z.object({
  document_id: z.string().uuid(),
  invoice_number: z.string(),
});

export const subscriptionAuthorizedDownloadSchema = z.object({
  document_id: z.string().uuid(),
  invoice_number: z.string(),
  storage_path: z.string().min(1),
  file_sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
