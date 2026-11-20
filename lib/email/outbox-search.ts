/** 運営画面の「送信済みメールの確認」: RPCの結果を「成功（0件を含む）」と「取得失敗」に分ける。失敗を「該当なし」と表示しないため。 */
export type FindResult<T> = { failed: boolean; rows: T[] };

export function classifyFind<T>(res: { data: unknown; error: unknown } | null): FindResult<T> | null {
  if (!res) return null; // 検索していない（検索語が短い）
  if (res.error || !Array.isArray(res.data)) return { failed: true, rows: [] };
  return { failed: false, rows: res.data as T[] };
}
