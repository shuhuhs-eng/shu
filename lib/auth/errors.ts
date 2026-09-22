/**
 * Supabase Auth が返す英語のエラーメッセージを、ユーザー向けの日本語メッセージへ変換する。
 * 該当が無い場合は詳細を出さず一般的なメッセージにフォールバックする
 * （内部エラーの詳細をそのまま画面に出さないため）。
 */
const MESSAGE_MAP: Array<[string, string]> = [
  ["Invalid login credentials", "メールアドレスまたはパスワードが正しくありません。"],
  ["Email not confirmed", "メールアドレスが未確認です。届いている確認メールのリンクをクリックしてください。"],
  ["User already registered", "このメールアドレスは既に登録されています。"],
  ["Password should be at least", "パスワードは8文字以上で入力してください。"],
  // Supabase Auth側でパスワードポリシー(文字種要求)を設定した場合に返る文言
  // （"Password should contain at least one character of each: ..." 等、
  // 具体的な文言はSupabaseのバージョン・設定により変わるため広めに拾う）。
  ["Password should contain", "パスワードは8文字以上で、英字と数字をそれぞれ1文字以上含めてください。"],
  ["password is too weak", "パスワードは8文字以上で、英字と数字をそれぞれ1文字以上含めてください。"],
  ["For security purposes", "しばらく時間をおいてから再度お試しください。"],
  ["Email rate limit exceeded", "メール送信回数の上限に達しました。しばらくしてから再度お試しください。"],
  ["Token has expired or is invalid", "リンクの有効期限が切れています。もう一度手続きをやり直してください。"],
];

export function mapAuthError(message: string): string {
  const lower = message.toLowerCase();
  const hit = MESSAGE_MAP.find(([needle]) => lower.includes(needle.toLowerCase()));
  return hit ? hit[1] : "エラーが発生しました。しばらくしてから再度お試しください。";
}
