/**
 * マイページの「診断をもう一度受ける」案内用に、回数制限（0058）の状態を読み、文言を決める。
 *
 * ★0058・0059は本番に未適用。制限の関数（get_diagnosis_change_status）が無い・呼べない・想定外の形のときは
 *   "unknown"（＝制限は有効になっていない）として扱い、「変更は1回」「3か月」などの制限の説明を【表示しない】。
 *   表示だけで制限が有効になったように見せないため。0058の適用後に関数が状態を返すようになると、自動で説明と次回日時が出る。
 */
export type RetakeLimitState = "unknown" | "none" | "can_change" | "locked";
export type RetakeLimit = { state: RetakeLimitState; lockedUntil: string | null };

export const LIMIT_UNKNOWN: RetakeLimit = { state: "unknown", lockedUntil: null };

export function parseRetakeLimit(raw: unknown): RetakeLimit {
  if (!raw || typeof raw !== "object") return LIMIT_UNKNOWN;
  const r = raw as Record<string, unknown>;
  if (r.state === "none" || r.state === "can_change") return { state: r.state, lockedUntil: null };
  if (r.state === "locked") {
    const until = typeof r.locked_until === "string" ? r.locked_until : null;
    if (!until || Number.isNaN(Date.parse(until))) return LIMIT_UNKNOWN;
    return { state: "locked", lockedUntil: until };
  }
  return LIMIT_UNKNOWN;
}

type RpcCaller = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/** 本人のJWTで状態を読む。関数が無い（0058未適用）・通信失敗は unknown。例外は投げない。 */
export async function getStylistRetakeLimit(supabase: unknown): Promise<RetakeLimit> {
  try {
    const { data, error } = await (supabase as RpcCaller).rpc("get_diagnosis_change_status", { p_kind: "stylist", p_store_id: null });
    if (error) return LIMIT_UNKNOWN;
    return parseRetakeLimit(data);
  } catch {
    return LIMIT_UNKNOWN;
  }
}

/** 例: 2027年2月13日 18時10分（日本時間） */
export function formatJstDateTime(iso: string): string {
  const p = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}年${g("month")}月${g("day")}日 ${g("hour")}時${g("minute")}分`;
}

export const RETAKE_RULE_TEXT = "初回診断後、変更は1回できます。変更後は3か月間変更できません。";

export type RetakeNotice = {
  /** 制限が有効なときだけ出す説明。無効（unknown）のときは null。 */
  rule: string | null;
  /** 制限中のとき、次回変更できる日時の案内。 */
  lockedText: string | null;
  /** 診断へ進めるか（制限中は false）。 */
  canStart: boolean;
};

export function retakeNotice(limit: RetakeLimit): RetakeNotice {
  if (limit.state === "locked" && limit.lockedUntil) {
    return { rule: RETAKE_RULE_TEXT, lockedText: `次に変更できるのは ${formatJstDateTime(limit.lockedUntil)}（日本時間）以降です。`, canStart: false };
  }
  if (limit.state === "none" || limit.state === "can_change") return { rule: RETAKE_RULE_TEXT, lockedText: null, canStart: true };
  return { rule: null, lockedText: null, canStart: true };
}
