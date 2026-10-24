import { createHash } from "node:crypto";
import type { LegalDocument } from "./documents";

/**
 * 本文のハッシュ（SHA-256）。同意の記録に「どの本文に同意したか」を残すために使う。
 * 題名・前文・全セクションを決まった形に直してから計算する（運営者情報は含めない）。
 */
export function legalDocumentHash(doc: LegalDocument): string {
  const canonical = JSON.stringify({
    type: doc.type,
    title: doc.title,
    version: doc.version,
    lead: doc.lead,
    sections: doc.sections.map((s) => ({ heading: s.heading, paragraphs: s.paragraphs, items: s.items ?? [] })),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
