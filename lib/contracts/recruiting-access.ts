/**
 * 契約状態による「新しい採用活動」の制御（0044）をUIへ出すための共通定義。
 *
 * ★契約status（試用中・一時停止・解約など）や契約金額は、ここにも画面にも一切出さない。
 * 画面に出すのは「現在、この店舗では新しい採用活動を受け付けていません」という文言だけ。
 * 制御の本体はDB(RPC)側のguardで、UIのdisabledは事前表示のための補助にすぎない。
 */

export const RECRUITING_PAUSED_MESSAGE = "現在、この店舗では新しい採用活動を受け付けていません";

/** DBのguardが返すエラー文（0044）。画面にはそのまま出さず、日本語に変換する。 */
const RECRUITING_PAUSED_DB_MESSAGE = "recruiting is paused for this organization";

export function isRecruitingPausedError(message: string | undefined | null): boolean {
  return (message ?? "").includes(RECRUITING_PAUSED_DB_MESSAGE);
}

/** get_store_recruiting_access の返却（new_recruiting_allowed / reason_code のみ）。 */
export type StoreRecruitingAccess = {
  new_recruiting_allowed: boolean;
  reason_code: "recruiting_paused" | null;
};

/**
 * 画面側の判定結果。取得に失敗した場合は paused=false（=従来どおり操作できる）にする。
 * 失敗時に誤って止めない／契約状態を推測しないためで、最終防衛はDB guardが行う。
 */
export type RecruitingAccessView = { paused: boolean };

export function toRecruitingAccessView(data: unknown): RecruitingAccessView {
  if (typeof data !== "object" || data === null) return { paused: false };
  const allowed = (data as { new_recruiting_allowed?: unknown }).new_recruiting_allowed;
  return { paused: allowed === false };
}
