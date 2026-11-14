/**
 * 回数制限（0058）まわりの、画面に出す文言と判定の純粋関数。DBやNext.jsには依存しない。
 * ★0058の適用前でも壊れないよう、状態が取れないとき（state: "unknown"）は案内を出さないだけにしている。
 */

export type LimitState = "none" | "can_change" | "locked" | "unknown";
export type LimitStatus = { state: LimitState; lockedUntil: string | null; changeCount: number };

export const UNKNOWN_STATUS: LimitStatus = { state: "unknown", lockedUntil: null, changeCount: 0 };

/** get_diagnosis_change_status の戻り値を安全に読む（想定外の形は unknown）。 */
export function parseLimitStatus(raw: unknown): LimitStatus {
  if (!raw || typeof raw !== "object") return UNKNOWN_STATUS;
  const r = raw as Record<string, unknown>;
  const state = r.state;
  if (state === "none") return { state, lockedUntil: null, changeCount: 0 };
  if (state === "can_change" || state === "locked") {
    const until = typeof r.locked_until === "string" ? r.locked_until : null;
    if (state === "locked" && (!until || Number.isNaN(Date.parse(until)))) return UNKNOWN_STATUS;
    return { state, lockedUntil: state === "locked" ? until : null, changeCount: typeof r.change_count === "number" ? r.change_count : 0 };
  }
  return UNKNOWN_STATUS;
}

const JST = "Asia/Tokyo";

/** 例: 2027年2月13日（日本時間） */
export function formatJstDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p = new Intl.DateTimeFormat("ja-JP", { timeZone: JST, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}年${g("month")}月${g("day")}日`;
}

/** 例: 2027年2月13日 18時10分（日本時間） */
export function formatJstDateTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p = new Intl.DateTimeFormat("ja-JP", { timeZone: JST, hour: "numeric", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${formatJstDate(d)} ${g("hour")}時${g("minute")}分`;
}

/**
 * 保存成功の時点から「日本時間の暦で3か月後」。DB側（_diagnosis_limit_gate）と同じ規則: 同じ時刻・月末は月内に丸める（11/30 → 2/28）。
 * 画面の事前案内用の目安であり、実際の解除日時は保存時にDBが決める（結果として返る locked_until を表示する）。
 */
export function addThreeMonthsJst(from: Date): Date {
  // 日本時間の壁時計（UTC+9固定。夏時間なし）で計算してから戻す
  const jst = new Date(from.getTime() + 9 * 3600_000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth() + 3;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(jst.getUTCDate(), lastDay);
  const out = new Date(Date.UTC(y, m, day, jst.getUTCHours(), jst.getUTCMinutes(), jst.getUTCSeconds(), jst.getUTCMilliseconds()));
  return new Date(out.getTime() - 9 * 3600_000);
}

/** 確認画面（保存前）に出す、回数の案内。 */
export function confirmNotice(
  status: LimitStatus,
  now: Date = new Date(),
  opts: { unchanged?: boolean; extraFirst?: boolean } = {},
): { lines: string[]; blocking: boolean } {
  // サロン: 公開中の結果と回答が同じ、または未回答だった追加5問を初めて完成させるだけなら、変更として数えない（ロック中でも確定できる）
  if (status.state !== "none" && status.state !== "unknown" && (opts.unchanged || opts.extraFirst)) {
    return {
      lines: [
        opts.extraFirst
          ? "追加の5問を初めて回答するだけなので、変更として数えません。ロック中でも保存できます。"
          : "回答は公開中の結果と同じなので、変更として数えません。",
      ],
      blocking: false,
    };
  }
  if (status.state === "locked" && status.lockedUntil) {
    return { lines: [`次に変更できるのは ${formatJstDateTime(status.lockedUntil)} 以降です。それまでは結果を変更できません。`], blocking: true };
  }
  if (status.state === "none") {
    return {
      lines: ["これが最初の診断結果になります。", "保存したあと、結果を変更できるのは1回だけです。"],
      blocking: false,
    };
  }
  if (status.state === "can_change") {
    return {
      lines: [
        "この内容で保存すると、結果が変わります。",
        `保存すると、${formatJstDate(addThreeMonthsJst(now))} 以降まで、結果を変更できなくなります（保存した日から日本時間で3か月）。`,
        "回答が前回と同じ場合は、保存しても変更とは数えません。",
      ],
      blocking: false,
    };
  }
  return { lines: [], blocking: false };
}

export type LimitErrorCode =
  | "locked"
  | "already_saved"
  | "use_confirm"
  | "content_mismatch"
  | "request_reused"
  | "draft_changed"
  | "extra_required"
  | "draft_incomplete"
  | "not_allowed"
  | "not_authenticated"
  | "unknown";

export type LimitError = { code: LimitErrorCode; message: string; lockedUntil: string | null };

const NOT_COUNTED = "今回の保存は変更回数に数えていません。";

/** DB（0058）が返すエラーを、利用者向けの文言とコードに直す。 */
export function mapLimitError(err: { message?: string | null; details?: string | null } | null | undefined): LimitError {
  const msg = (err?.message ?? "").toLowerCase();
  const detail = err?.details ?? null;
  if (msg.includes("diagnosis_change_locked")) {
    const until = detail && !Number.isNaN(Date.parse(detail)) ? detail : null;
    return {
      code: "locked",
      lockedUntil: until,
      message: until
        ? `次に変更できるのは ${formatJstDateTime(until)} 以降です。${NOT_COUNTED}`
        : `いまは結果を変更できない期間です。${NOT_COUNTED}`,
    };
  }
  if (msg.includes("diagnosis_already_saved"))
    return { code: "already_saved", lockedUntil: null, message: "すでに診断結果が保存されているため、ログイン前の診断は追加しませんでした。" };
  if (msg.includes("diagnosis_use_confirm"))
    return { code: "use_confirm", lockedUntil: null, message: `この画面からは保存できません。確認画面から保存してください。${NOT_COUNTED}` };
  if (msg.includes("request id content mismatch"))
    return { code: "content_mismatch", lockedUntil: null, message: `回答の内容が前回の送信と違うため、保存しませんでした。確認画面からもう一度保存してください。${NOT_COUNTED}` };
  if (msg.includes("request id reused"))
    return { code: "request_reused", lockedUntil: null, message: `保存の操作を確認できませんでした。もう一度お試しください。${NOT_COUNTED}` };
  if (msg.includes("draft_changed"))
    return { code: "draft_changed", lockedUntil: null, message: `別の画面で回答が更新されています。内容を確認して、もう一度保存してください。${NOT_COUNTED}` };
  if (msg.includes("extra answers required"))
    return { code: "extra_required", lockedUntil: null, message: `追加の質問への回答がそろっていないため、保存できません。${NOT_COUNTED}` };
  if (msg.includes("draft incomplete"))
    return { code: "draft_incomplete", lockedUntil: null, message: `未回答の質問があります。すべて答えてから保存してください。${NOT_COUNTED}` };
  if (msg.includes("not allowed to edit this store"))
    return { code: "not_allowed", lockedUntil: null, message: "この店舗の診断を保存する権限がありません（閲覧のみの権限では保存できません）。" };
  if (msg.includes("not authenticated"))
    return { code: "not_authenticated", lockedUntil: null, message: "ログインの有効期限が切れました。ログインし直してください。" };
  return { code: "unknown", lockedUntil: null, message: `結果の保存に失敗しました。${NOT_COUNTED}もう一度お試しください。` };
}

/** 追加5問の回答画面に出す、回数の案内（保存前）。判定は保存時にDB。 */
export function extraNotice(
  status: LimitStatus,
  o: { hadExtra: boolean; pendingTwelveChange: boolean },
  now: Date = new Date(),
): string[] {
  const lines: string[] = [];
  if (o.pendingTwelveChange) lines.push("未確定の12問の変更があります。この保存で、12問の変更とあわせて確定します。");
  if (!o.hadExtra && !o.pendingTwelveChange) {
    lines.push("追加の5問を初めて回答する場合は、変更として数えません。");
    return lines;
  }
  if (status.state === "locked" && status.lockedUntil) {
    lines.push(`次に変更できるのは ${formatJstDateTime(status.lockedUntil)} 以降です。それまでは、前回と同じ回答のままなら保存できますが、回答を変える保存はできません。`);
  } else if (status.state === "can_change") {
    lines.push(`前回の回答から変える場合は、変更として数えます。保存すると、${formatJstDate(addThreeMonthsJst(now))} 以降まで変更できなくなります（日本時間で3か月）。`);
  }
  return lines;
}
