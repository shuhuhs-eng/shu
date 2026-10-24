/**
 * 規約・プライバシーポリシーに表示する運営者の情報。
 *
 * ★会社名・住所・問い合わせ先・施行日は確定値がコードから取得できないため、
 *   コードに書かず、環境変数で設定する。未設定のときは「準備中」と表示する
 *   （勝手な値は作らない）。公開前に必ず次の環境変数を設定すること：
 *     LEGAL_OPERATOR_NAME     運営者の名称（例：株式会社〇〇）
 *     LEGAL_OPERATOR_ADDRESS  運営者の所在地
 *     LEGAL_CONTACT_EMAIL     問い合わせ先メールアドレス
 *     LEGAL_EFFECTIVE_DATE    施行日（YYYY-MM-DD）
 */
export type LegalOperatorInfo = {
  name: string | null;
  address: string | null;
  contactEmail: string | null;
  effectiveDate: string | null;
};

function env(key: string): string | null {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : null;
}

export function getLegalOperatorInfo(): LegalOperatorInfo {
  const date = env("LEGAL_EFFECTIVE_DATE");
  return {
    name: env("LEGAL_OPERATOR_NAME"),
    address: env("LEGAL_OPERATOR_ADDRESS"),
    contactEmail: env("LEGAL_CONTACT_EMAIL"),
    effectiveDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
  };
}

/** 運営者情報がすべて設定されているか（公開前チェック用）。 */
export function isLegalOperatorInfoComplete(info: LegalOperatorInfo): boolean {
  return Boolean(info.name && info.address && info.contactEmail && info.effectiveDate);
}
