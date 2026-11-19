/**
 * 店舗への直接希望の種別（0095）。visit=見学／trial=体験入店。
 * 旧DB（0095適用前）や旧RPCの戻り値には kind が無い。その場合は「見学」として扱う
 * （既存の直接希望は見学として維持し、体験入店へは読み替えない）。
 */
export const INTEREST_KINDS = ["visit", "trial"] as const;
export type InterestKind = (typeof INTEREST_KINDS)[number];

export const INTEREST_KIND_LABELS: Record<InterestKind, string> = {
  visit: "見学を希望する",
  trial: "体験入店を希望する",
};
export const INTEREST_KIND_CANCEL_LABELS: Record<InterestKind, string> = {
  visit: "見学の希望を取り消す",
  trial: "体験入店の希望を取り消す",
};
/** バッジ用の短い名称。 */
export const INTEREST_KIND_SHORT: Record<InterestKind, string> = { visit: "見学", trial: "体験入店" };

export function isInterestKind(v: unknown): v is InterestKind {
  return v === "visit" || v === "trial";
}

/** kind が無い・不明な値は見学（旧データ互換）。 */
export function normalizeInterestKind(v: unknown): InterestKind {
  return v === "trial" ? "trial" : "visit";
}

/** 行の集合から、種別ごとの送信済みを返す（kind列が無い旧DBの行は見学扱い）。 */
export function interestedKinds(rows: Array<{ kind?: unknown }> | null | undefined): Record<InterestKind, boolean> {
  const out: Record<InterestKind, boolean> = { visit: false, trial: false };
  for (const r of rows ?? []) out[normalizeInterestKind(r.kind)] = true;
  return out;
}

/** PostgREST: 関数が無い（DB未適用）。 */
export function isMissingRpcError(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "PGRST202" || e.code === "42883" || /could not find the function|does not exist/i.test(e.message ?? "");
}
/** 列が無い（DB未適用で kind を select した）。 */
export function isMissingColumnError(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42703" || /column .*kind.* does not exist|could not find the 'kind' column/i.test(e.message ?? "");
}

/**
 * 店舗側の受信一覧: 同じ美容師の見学・体験入店を1人1枚にまとめる（種別ごとの送信日時を保持）。
 * 並びは最初に出た行の順。kind が無い行（旧RPC）は見学。
 */
export function groupInterestsByStylist<T extends { stylist_user_id: string; kind?: unknown; created_at: string }>(
  rows: T[],
): Array<{ interest: T; kinds: Array<{ kind: InterestKind; created_at: string }> }> {
  const order: string[] = [];
  const map = new Map<string, { interest: T; kinds: Array<{ kind: InterestKind; created_at: string }> }>();
  for (const r of rows) {
    const k = normalizeInterestKind(r.kind);
    const g = map.get(r.stylist_user_id);
    if (!g) {
      order.push(r.stylist_user_id);
      map.set(r.stylist_user_id, { interest: r, kinds: [{ kind: k, created_at: r.created_at }] });
    } else if (!g.kinds.some((x) => x.kind === k)) {
      g.kinds.push({ kind: k, created_at: r.created_at });
    }
  }
  for (const g of map.values()) g.kinds.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "visit" ? -1 : 1));
  return order.map((id) => map.get(id)!);
}
