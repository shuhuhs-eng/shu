/** 運営の一覧のページ番号・件数（純粋な処理。権限・DB呼び出しを持たない）。 */
export const PAGE_SIZE = 30;
type Sp = Record<string, string | string[] | undefined>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export function parsePage(sp: Sp): number {
  const n = Number.parseInt(one(sp.page), 10);
  return Number.isFinite(n) && n >= 1 && n <= 1000 ? n : 1;
}
