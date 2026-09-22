/**
 * ログ出力専用。メールアドレスの全文を残さないよう、先頭1〜2文字とドメインの
 * 一部だけを残してマスクする（例: "taro@example.com" → "t***@e***.com"）。
 * DB保存には使わない（DBには入力された値をそのまま保存する。マスクはログ専用）。
 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const maskedLocal = local.length <= 1 ? "*" : `${local[0]}***`;

  const dotIndex = domain.indexOf(".");
  const maskedDomain =
    dotIndex > 0 ? `${domain[0]}***${domain.slice(dotIndex)}` : `${domain.slice(0, 1)}***`;

  return `${maskedLocal}@${maskedDomain}`;
}
