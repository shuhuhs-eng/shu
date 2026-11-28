/**
 * 地域マスター（region_master）の表示用の整形。判定・並びはDBが決める。ここは選択UIの木構造と選択操作だけを持つ。
 *  - 有効期間（valid_from/valid_to）は日本時間の「今日」で判定する（DBの _area_is_valid と同じ考え方。最終判定はDB）。
 *  - 親子は同時に選べない（DBは overlapping_codes で拒否）。UIは選択時に重なる側を外す。
 */
export type RegionRow = {
  code: string; level: "pref" | "city" | "ward"; pref_code: string; parent_code: string | null; name: string;
  has_wards: boolean; valid_from: string | null; valid_to: string | null;
};
export type RegionNode = RegionRow & { children: RegionNode[] };

/** 日本時間の今日（YYYY-MM-DD）。 */
export function todayJst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
export function isRegionValid(r: Pick<RegionRow, "valid_from" | "valid_to">, today: string): boolean {
  return (r.valid_from == null || r.valid_from <= today) && (r.valid_to == null || r.valid_to >= today);
}

/** 都道府県 → 市区町村 → 区 の木。有効なものだけ。親が無効・無いものは落とす。 */
export function buildRegionTree(rows: readonly RegionRow[], today: string): RegionNode[] {
  const valid = rows.filter((r) => isRegionValid(r, today));
  const byCode = new Map<string, RegionNode>(valid.map((r) => [r.code, { ...r, children: [] }]));
  const roots: RegionNode[] = [];
  for (const node of byCode.values()) {
    if (node.level === "pref") { roots.push(node); continue; }
    const parent = node.parent_code ? byCode.get(node.parent_code) : undefined;
    if (parent) parent.children.push(node);
  }
  const sort = (xs: RegionNode[]) => { xs.sort((a, b) => a.code.localeCompare(b.code)); xs.forEach((x) => sort(x.children)); };
  sort(roots);
  return roots;
}

export function ancestorsOf(code: string, byCode: ReadonlyMap<string, RegionRow>): string[] {
  const out: string[] = []; let cur = byCode.get(code);
  while (cur?.parent_code) { out.push(cur.parent_code); cur = byCode.get(cur.parent_code); }
  if (cur && cur.level !== "pref") out.push(cur.pref_code);
  return out;
}
export function descendantsOf(code: string, rows: readonly RegionRow[]): string[] {
  const kids = rows.filter((r) => r.parent_code === code).map((r) => r.code);
  return kids.flatMap((k) => [k, ...descendantsOf(k, rows)]);
}

/**
 * 選択の切り替え。選ぶと、その祖先・子孫（重なる地域）は外す。上限を超える追加は拒否して理由を返す。
 * 政令指定都市（has_wards）の市そのものの選択は許す（希望勤務地は市全体でもよい）。店舗の所在地確定は別（区まで必須）。
 */
export function toggleRegion(selected: readonly string[], code: string, rows: readonly RegionRow[], max: number): { next: string[]; error: "too_many" | null } {
  if (selected.includes(code)) return { next: selected.filter((c) => c !== code), error: null };
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const drop = new Set([...ancestorsOf(code, byCode), ...descendantsOf(code, rows)]);
  const next = [...selected.filter((c) => !drop.has(c)), code];
  if (next.length > max) return { next: [...selected], error: "too_many" };
  return { next, error: null };
}

/** 選択済みコードの表示名（画面の「選択中」用）。 */
export function regionLabel(code: string, rows: readonly RegionRow[]): string {
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const r = byCode.get(code); if (!r) return code;
  const parent = r.parent_code ? byCode.get(r.parent_code) : undefined;
  const grand = parent?.parent_code ? byCode.get(parent.parent_code) : undefined;
  return [byCode.get(r.pref_code)?.name !== r.name ? byCode.get(r.pref_code)?.name : null, grand ? null : null, parent && parent.level !== "pref" ? parent.name : null, r.name].filter(Boolean).join(" ");
}

/**
 * 地域名の検索（選択画面の絞り込み用）。表示名はDBのマスターのまま（例: 39405 は「梼原町」）。
 *  - 全角半角・空白の違いは無視する（NFKC）。
 *  - 異体字: 檮 は 梼 として照合する（e-Stat・国土数値情報の表記「檮原町」でも「梼原町」でも当たる）。
 *  - REGION_NAME_ALIASES: 公式資料間で表記が違う地域の別名（コード → 別名）。表示には使わない。
 */
export const REGION_NAME_ALIASES: Readonly<Record<string, readonly string[]>> = { "39405": ["檮原町"] };
const VARIANT_FOLD: Readonly<Record<string, string>> = { "檮": "梼" };

export function foldRegionText(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, "").replace(/./gu, (ch) => VARIANT_FOLD[ch] ?? ch);
}
export function matchesRegionQuery(r: Pick<RegionRow, "code" | "name">, query: string): boolean {
  const q = foldRegionText(query);
  if (!q) return false;
  return [r.name, ...(REGION_NAME_ALIASES[r.code] ?? [])].some((n) => foldRegionText(n).includes(q));
}
/** 絞り込み結果（コード順・最大 limit 件）。空の検索語は空配列。 */
export function filterRegions(rows: readonly RegionRow[], query: string, limit = 50): RegionRow[] {
  return rows.filter((r) => matchesRegionQuery(r, query)).sort((a, b) => a.code.localeCompare(b.code)).slice(0, limit);
}
