/**
 * 範囲指定つき分割取得の純関数（server-only に依存しないので node:test で試験できる）。
 * - 件数(count)を先に確定し、取得できた行数がそれに一致したときだけ成功とする。
 *   途中の失敗・サーバー側の最大行数による打ち切り・件数の食い違いは null（＝「全件取得」とは扱わない）。
 * - 並び順は呼び出し側が一意キー（region_master は version_id 内で code が一意）で固定する。
 * - サーバー側の最大行数が pageSize より小さくても、返った行数ぶん進めて続行する。
 */
export type PageResult<T> = { data: T[] | null; error: unknown; count?: number | null };

export async function fetchAllPaged<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts: { pageSize?: number; maxRows?: number; keyOf?: (row: T) => string } = {},
): Promise<T[] | null> {
  const pageSize = opts.pageSize ?? 1000;
  const maxRows = opts.maxRows ?? 100_000;
  const rows: T[] = [];
  let total: number | null = null;
  // 無限ループ防止（1行ずつ返る最悪の場合でも maxRows 回まで）
  for (let guard = 0; guard <= maxRows; guard++) {
    if (total !== null && rows.length >= total) break;
    const from = rows.length;
    let res: PageResult<T>;
    try {
      res = await fetchPage(from, from + pageSize - 1);
    } catch {
      return null;
    }
    if (res.error || !Array.isArray(res.data)) return null;
    if (total === null) {
      if (typeof res.count !== "number" || res.count < 0 || res.count > maxRows) return null;
      total = res.count;
    } else if (typeof res.count === "number" && res.count !== total) {
      return null; // 取得中に件数が変わった（版の入れ替わり等）→ 不整合
    }
    if (res.data.length === 0) {
      if (rows.length >= total) break;
      return null; // 件数に達していないのに空 → 欠落
    }
    rows.push(...res.data);
    if (rows.length > total) return null;
  }
  if (total === null || rows.length !== total) return null;
  if (opts.keyOf) {
    const seen = new Set<string>();
    for (const r of rows) {
      const k = opts.keyOf(r);
      if (seen.has(k)) return null;
      seen.add(k);
    }
  }
  return rows;
}
