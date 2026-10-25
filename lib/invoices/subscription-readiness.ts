import { z } from "zod";

const readinessSchema = z.object({
  already_issued: z.boolean(),
  missing: z.array(z.string()),
  warnings: z.array(z.string()).optional(),
});

/** get_subscription_invoice_issue_readiness の戻り値を安全に解釈する（不正な形は例外）。 */
export function readinessForAdmin(raw: unknown): { alreadyIssued: boolean; missing: string[] } {
  const p = readinessSchema.parse(raw);
  return { alreadyIssued: p.already_issued, missing: p.missing };
}
