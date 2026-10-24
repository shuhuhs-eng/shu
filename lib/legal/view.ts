import { getCurrentLegalDocuments } from "./actions";
import { getLegalOperatorInfo } from "./config";
import { LEGAL_DOCUMENTS, type LegalDocumentType } from "./documents";
import { parseLegalSnapshot } from "./snapshot";
import type { LegalView } from "@/components/legal/legal-page";

/**
 * 公開ページに表示する内容。公開済みの現在の版があれば、DBに保存した本文（運営者情報・施行日を含む）を
 * そのまま表示する（環境変数やコードが後から変わっても、公開した版の表示は変わらない）。
 * 公開された版がまだ無い間は、コードの草案と現在の環境設定（未設定は「準備中」）を表示する。
 */
export async function getLegalView(type: LegalDocumentType): Promise<LegalView | null> {
  const current = await getCurrentLegalDocuments();
  // 公開状況を確認できないときは、草案を代わりに出さない（誤った本文を見せない）。
  if (current === null) return null;
  const published = current?.find((d) => d.document_type === type);
  if (published) {
    const snap = parseLegalSnapshot(published.content_snapshot);
    if (snap) {
      return {
        title: snap.title,
        version: snap.version,
        effectiveDate: snap.effective_date,
        operator: { name: snap.operator.name, address: snap.operator.address, contact: snap.operator.contact },
        lead: snap.lead,
        sections: snap.sections,
      };
    }
  }
  const doc = LEGAL_DOCUMENTS[type];
  const op = getLegalOperatorInfo();
  return {
    title: doc.title,
    version: doc.version,
    effectiveDate: op.effectiveDate,
    operator: { name: op.name, address: op.address, contact: op.contactEmail },
    lead: doc.lead,
    sections: doc.sections,
  };
}
