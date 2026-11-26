/** 台帳方式（SCOUT_LEDGER_ENABLED=1）のスカウト送信で、DBの例外メッセージを利用者向けの文言にそろえる。内部名（台帳・消費順）は出さない。 */
export function ledgerSendErrorMessage(dbMessage: string): string | null {
  if (dbMessage.includes("insufficient scout balance")) return "スカウトの残数が足りません。";
  if (dbMessage.includes("consume order is undecided")) return "スカウトを送信できませんでした。運営にお問い合わせください。";
  if (dbMessage.includes("legacy scout sending is closed") || dbMessage.includes("ledger scout sending is not active")) return "送信方式を切り替え中です。しばらくしてから、もう一度お試しください。";
  if (dbMessage.includes("request id already used with different content")) return "同じ送信操作の内容が変わっています。画面を更新して、もう一度送信してください。";
  return null;
}
/** 画面が送信ごとに持つ識別キー。同じ内容の再試行は同じキー（二重消費しない）、内容を変えたら新しいキー。成功したら捨てる。 */
export function makeRequestIdHolder(gen: () => string = () => crypto.randomUUID()) {
  let cur: { key: string; id: string } | null = null;
  return { get(key: string): string { if (!cur || cur.key !== key) cur = { key, id: gen() }; return cur.id; }, reset(): void { cur = null; } };
}
/** 切替の途中で方式が食い違ったときだけ、逆の方式で1回やり直す。それ以外は null（やり直さない）。 */
export function nextSendMode(dbMessage: string, usedLedger: boolean): boolean | null {
  if (!usedLedger && dbMessage.includes("legacy scout sending is closed")) return true;
  if (usedLedger && dbMessage.includes("ledger scout sending is not active")) return false;
  return null;
}
