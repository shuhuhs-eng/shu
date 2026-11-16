/**
 * 引き継ぎ（claim）の開始に失敗したとき、引き継ぎ用Cookie（claim_token）を**消してよいか**を決める。
 * 方針: 消すのは「このトークンは今後も再利用できない」と明確に確認できた場合だけ。
 * それ以外はすべて残す（関数が未反映・権限不足・認証の一時的な不整合・通信失敗・タイムアウト・不明なエラーを含む。
 * 障害が解消したあとの再試行で、同じ回答を取り込めるようにするため。再試行は冪等で、二重には保存されない）。
 *
 * 明確に再利用できない理由 = start_pending_diagnosis_claim が、条件に合う行が無いときに投げる例外
 *   'pending diagnosis not found, claimed by someone else, already completed, or expired'
 * （期限切れ・他のユーザーが処理中・完了済み・存在しない）。コード P0001 だけでは判断しない（'not authenticated' も P0001 のため）。
 * PGRST202（関数が無い）・42883・42501（権限不足）・HTTP 4xx も、障害の解消で直るので消さない。
 */
export type RpcErr = { message?: string; code?: string; status?: number } | null | undefined;

const UNRECOVERABLE_START = /pending diagnosis not found, claimed by someone else, already completed, or expired/;

export function isUnrecoverableStartError(err: RpcErr): boolean {
  if (!err) return false;
  return err.code === "P0001" && UNRECOVERABLE_START.test(err.message ?? "");
}
