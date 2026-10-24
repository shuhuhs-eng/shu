/**
 * 請求書PDFを発行できない理由（DBの不足コード）を、運営者向けの日本語にする。
 * 未知のコードでも内部名は出さず、汎用文言にする。
 */
const MISSING_LABELS: Record<string, string> = {
  fee_not_invoiced: "請求済みの状態になっていません",
  historical_invoice: "旧請求データのため、請求書PDFは発行できません",
  due_date: "支払期限が未設定です",
  tax_rate: "適用税率が未設定です",
  amounts: "請求金額が確定していません",
  issuer_legal_name: "発行事業者名が未登録です",
  issuer_registration_number: "インボイス登録番号が未登録です",
  issuer_address: "発行事業者の住所が未登録です",
  issuer_bank_name_missing: "振込先の銀行名が未登録です",
  issuer_bank_branch_name_missing: "振込先の支店名が未登録です",
  issuer_bank_account_type_missing: "振込先の口座種別が未登録です",
  issuer_bank_account_number_missing: "振込先口座番号が未登録です",
  issuer_bank_account_holder_missing: "振込先の口座名義が未登録です",
  recipient_legal_name: "請求先情報が未登録です",
};

export function missingLabel(code: string): string {
  return MISSING_LABELS[code] ?? "請求書の発行に必要な情報が不足しています";
}

export function missingLabels(codes: string[]): string[] {
  return Array.from(new Set(codes.map(missingLabel)));
}

/** 発行事業者設定が必要な不足コードか（案内リンクの出し分け用）。 */
export function needsIssuerSettings(codes: string[]): boolean {
  return codes.some((c) => c.startsWith("issuer_"));
}

/** 請求先の登録が必要か。 */
export function needsRecipientProfile(codes: string[]): boolean {
  return codes.includes("recipient_legal_name");
}

export const BANK_ACCOUNT_TYPE_LABELS: Record<string, string> = {
  ordinary: "普通",
  checking: "当座",
  savings: "貯蓄",
};

export function bankAccountTypeLabel(value: string | null): string {
  return value ? (BANK_ACCOUNT_TYPE_LABELS[value] ?? "") : "";
}
