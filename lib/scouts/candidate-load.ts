import type { PublicStylistForScout } from "@/lib/scouts/types";

/**
 * 候補取得（get_public_stylists_for_scout）の結果を「成功（0件を含む）」と「失敗」に分ける。
 * 取得失敗を「公開している美容師はいません」と誤表示しないため。
 *  - error があれば失敗
 *  - data が配列でなければ失敗（RPCは常に配列を返す。null等を0件と誤認しない）
 * 表示範囲・並び・相性計算には関与しない。
 */
export type CandidateLoad =
  | { ok: true; stylists: PublicStylistForScout[] }
  | { ok: false };

export function resolveCandidateLoad(result: { data: unknown; error: unknown }): CandidateLoad {
  if (result.error) return { ok: false };
  if (!Array.isArray(result.data)) return { ok: false };
  return { ok: true, stylists: result.data as PublicStylistForScout[] };
}

export const CANDIDATE_LOAD_FAILED_MESSAGE = "候補を取得できませんでした。時間をおいて、もう一度お試しください。";
export const CANDIDATE_EMPTY_MESSAGE = "現在、公開している美容師はいません。";
