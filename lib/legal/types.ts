import { z } from "zod";

export const legalTypeSchema = z.enum(["terms", "privacy"]);

export const acceptanceStatusSchema = z.object({
  accepted: z.boolean(),
  pending: z.array(z.object({
    document_id: z.string().uuid(),
    document_type: legalTypeSchema,
    version: z.string(),
    title: z.string(),
    content_hash: z.string(),
  })),
});
export type AcceptanceStatus = z.infer<typeof acceptanceStatusSchema>;

export const adminLegalDocumentSchema = z.object({
  document_id: z.string().uuid(),
  document_type: legalTypeSchema,
  version: z.string(),
  title: z.string(),
  content_hash: z.string(),
  content_snapshot: z.string(),
  effective_at: z.string(),
  published_at: z.string(),
  is_current: z.boolean(),
  accepted_count: z.number(),
});
export type AdminLegalDocument = z.infer<typeof adminLegalDocumentSchema>;

export type LegalActionResult = { success: true; message: string } | { success: false; error: string };

export const currentLegalDocumentSchema = z.object({
  document_id: z.string().uuid(),
  document_type: legalTypeSchema,
  version: z.string(),
  title: z.string(),
  content_hash: z.string(),
  content_snapshot: z.string(),
  effective_at: z.string(),
});
export type CurrentLegalDocument = z.infer<typeof currentLegalDocumentSchema>;
