import { z } from "zod";
import type { LegalDocument } from "./documents";
import type { LegalOperatorInfo } from "./config";

/**
 * 公開時にDBへ不変保存する「完成した本文」（運営者情報・施行日を含む）のJSON。
 * ★ここに入れた内容が、その版でユーザーに提示する本文のすべて。後から環境変数やコードが
 *   変わっても、DBに保存した本文は変わらない。ハッシュはDBが保存した本文から計算する。
 */
export const legalSnapshotSchema = z.object({
  document_type: z.enum(["terms", "privacy"]),
  version: z.string(),
  title: z.string(),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  operator: z.object({ name: z.string(), address: z.string(), contact: z.string() }),
  lead: z.string(),
  sections: z.array(z.object({
    heading: z.string(),
    paragraphs: z.array(z.string()),
    items: z.array(z.string()),
  })),
});
export type LegalSnapshot = z.infer<typeof legalSnapshotSchema>;

/** 運営者情報が揃っていなければ null（未設定のまま公開させない）。 */
export function buildLegalSnapshot(doc: LegalDocument, operator: LegalOperatorInfo, effectiveDate: string): LegalSnapshot | null {
  if (!operator.name || !operator.address || !operator.contactEmail) return null;
  return {
    document_type: doc.type,
    version: doc.version,
    title: doc.title,
    effective_date: effectiveDate,
    operator: { name: operator.name, address: operator.address, contact: operator.contactEmail },
    lead: doc.lead,
    sections: doc.sections.map((s) => ({ heading: s.heading, paragraphs: s.paragraphs, items: s.items ?? [] })),
  };
}

/** DBへ送る文字列。キーの順序が固定のため、同じ内容なら同じ文字列になる。 */
export function serializeLegalSnapshot(snapshot: LegalSnapshot): string {
  return JSON.stringify(snapshot);
}

/** DBに保存された本文を読む。壊れていれば null。 */
export function parseLegalSnapshot(text: string): LegalSnapshot | null {
  try {
    const parsed = legalSnapshotSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** 本文（題名・前文・条文）だけを比べる。運営者情報・施行日の違いは無視する（コードの本文が公開版と同じか）。 */
export function sameBody(a: LegalSnapshot, b: LegalSnapshot): boolean {
  return JSON.stringify([a.title, a.lead, a.sections]) === JSON.stringify([b.title, b.lead, b.sections]);
}
