/** 画面のクエリ文字列の検証（純粋関数）。形式が不正な値は捨てる。最終判定はDB。 */
/** クエリ文字列 codes=13,13101 を検証して返す（形式が不正なものは捨てる。上限は max）。 */
export function parseCodesParam(raw: string | string[] | undefined, max: number): string[] {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (!s) return [];
  return Array.from(new Set(s.split(",").map((x) => x.trim()).filter((x) => /^[0-9]{2}([0-9]{3})?$/.test(x)))).slice(0, max);
}
export function parseModeParam(raw: string | string[] | undefined): "near" | "all" | "manual" {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return s === "all" || s === "manual" ? s : "near";
}
