/** 台帳方式（SCOUT_LEDGER_ENABLED=1）のスカウト送信で、DBの例外メッセージを利用者向けの文言にそろえる。内部名（台帳・消費順）は出さない。 */
export function ledgerSendErrorMessage(dbMessage: string): string | null {
  if (dbMessage.includes("insufficient scout balance")) return "スカウトの残数が足りません。";
  if (dbMessage.includes("consume order is undecided")) return "スカウトを送信できませんでした。運営にお問い合わせください。";
  if (dbMessage.includes("scout sending is paused")) return "スカウトの送信は現在、一時停止中です。再開までお待ちください。";
  if (dbMessage.includes("legacy scout sending is closed") || dbMessage.includes("ledger scout sending is not active")) return "送信方式を切り替え中です。しばらくしてから、もう一度お試しください。";
  if (dbMessage.includes("request id already used with different content")) return "同じ送信操作の内容が変わっています。画面を更新して、もう一度送信してください。";
  return null;
}
/** 画面が送信ごとに持つ識別キー。同じ内容の再試行は同じキー（二重消費しない）、内容を変えたら新しいキー。成功したら捨てる。 */
export function makeRequestIdHolder(gen: () => string = () => crypto.randomUUID()) {
  let cur: { key: string; id: string } | null = null;
  return { get(key: string): string { if (!cur || cur.key !== key) cur = { key, id: gen() }; return cur.id; }, reset(): void { cur = null; } };
}
/** DBが「何も送信・消費していない」と明示する印（切替確認の拒否だけが付ける）。 */
export const NOTHING_DONE_HINT = "scout_nothing_done";
export type SendRpcError = { message: string; code?: string | null; hint?: string | null } | null;

/**
 * 切替の途中で方式が食い違ったときの再試行。DBが「何も行っていない」と明示した（hint）ときだけ、逆の方式で1回やり直す。
 * それ以外（通信切れ・タイムアウトなど結果が分からない場合を含む）は null＝別の方式では送り直さない。
 */
export function nextSendMode(error: SendRpcError, usedLedger: boolean): boolean | null {
  if (!error || error.hint !== NOTHING_DONE_HINT) return null;
  if (!usedLedger && error.message.includes("legacy scout sending is closed")) return true;
  if (usedLedger && error.message.includes("ledger scout sending is not active")) return false;
  return null;
}

/** 結果が分からない失敗か（DBのエラーコードが無い＝通信の途中で切れた等。DBが「できなかった」と返したものは含めない）。 */
export function isUnknownOutcome(error: SendRpcError, thrown: boolean): boolean {
  return thrown || (error !== null && !error.code);
}
export const UNKNOWN_OUTCOME_MESSAGE = "送信の結果を確認できませんでした。送信済みかどうかを画面で確認してから、必要なら送り直してください。";
