/**
 * Supabase Auth が返す英語のエラーメッセージを、ユーザー向けの日本語メッセージへ変換する。
 * 該当が無い場合は詳細を出さず一般的なメッセージにフォールバックする
 * （内部エラーの詳細をそのまま画面に出さないため）。
 */
const GENERIC_MESSAGE = "エラーが発生しました。しばらくしてから再度お試しください。";

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
  return hit ? hit[1] : GENERIC_MESSAGE;
}

type AuthErrorLike = { message: string; code?: string; status?: number; name?: string };

const CODE_MAP: Record<string, string> = {
  captcha_failed: "ロボットでないことの確認に失敗しました。ページを再読み込みして、もう一度お試しください。",
  over_email_send_rate_limit: "メール送信回数の上限に達しました。しばらくしてから再度お試しください。",
  over_request_rate_limit: "しばらく時間をおいてから再度お試しください。",
  user_already_exists: "このメールアドレスは既に登録されています。",
  email_exists: "このメールアドレスは既に登録されています。",
  weak_password: "パスワードは8文字以上で、英字と数字をそれぞれ1文字以上含めてください。",
};

/**
 * auth-js 2.108.2以降は、HTTP 5xxを AuthRetryableFetchError(message=応答本文のmsg, status, code無し) として返し、
 * error_codeを捨てる（supabase-js#2585）。本文のmsgはmessageに残るため、固定の分類ラベルへ変換して診断に使う。
 * 生のmessage（メール等を含み得る）は画面・ログへ出さず、下の許可リストのラベルだけを出す。
 */
const MESSAGE_LABELS: Array<[RegExp, string]> = [
  [/database error saving new user/i, "db_error_saving_new_user"],
  [/error sending (confirmation|recovery|magic|invite|email)/i, "email_send_failed"],
  [/captcha/i, "captcha"],
  [/smtp|mail/i, "mail_other"],
  [/hook/i, "auth_hook"],
  [/timeout|timed out/i, "timeout"],
  [/unexpected_failure|internal/i, "internal"],
  [/^\{\}$|^$/, "empty_body"],
];

export function classifyAuthMessage(message: string): string {
  const hit = MESSAGE_LABELS.find(([re]) => re.test(message ?? ""));
  return hit ? hit[1] : "other";
}

/**
 * Supabase Authのエラーを利用者向けメッセージへ変換する（codeを優先、無ければ文言で判定）。
 * 運用調査のため、code / status / nameだけをサーバーログへ残す
 * （message本文・メールアドレス・パスワード・トークンは出さない）。
 */
export function describeAuthError(action: string, error: AuthErrorLike): string {
  console.error("[auth] request failed", { action, code: error.code ?? null, status: error.status ?? null, name: error.name ?? null, reason: classifyAuthMessage(error.message) });
  if (error.code && CODE_MAP[error.code]) return CODE_MAP[error.code];
  const mapped = mapAuthError(error.message);
  // 既知の文言に当てはまらない場合だけ、原因調査用に非機密のエラーコード/ステータスを画面にも添える
  // （サポート時に利用者が読み上げられるようにするため。message本文は出さない）。
  if (mapped === GENERIC_MESSAGE) {
    const parts = [error.code, error.status != null ? String(error.status) : null, error.name, `reason=${classifyAuthMessage(error.message)}`].filter(Boolean);
    // 表示されたデプロイを特定できるよう、コミットの短縮ID（非機密）も添える。
    const build = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
    const detail = [parts.length > 0 ? parts.join(" / ") : "unknown", build ? `build ${build}` : null].filter(Boolean).join(" · ");
    return `${GENERIC_MESSAGE}（エラーコード: ${detail}）`;
  }
  return mapped;
}
