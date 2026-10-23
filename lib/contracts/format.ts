import type { AdminContractEvent, ContractStatus } from "./types";
import { CONTRACT_STATUSES } from "./types";

/** 画面に出す日本語。内部コード（trial / active など）はそのまま表示しない。 */
export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  trial: "試用中",
  active: "契約中",
  suspended: "一時停止",
  cancelled: "解約",
};

export function contractStatusLabel(status: string | null): string {
  if (status === null) return "契約条件未設定";
  return (CONTRACT_STATUS_LABELS as Record<string, string>)[status] ?? "確認中";
}

export function isContractStatus(value: string): value is ContractStatus {
  return (CONTRACT_STATUSES as readonly string[]).includes(value);
}

export const SUCCESS_FEE_MODE_LABELS: Record<string, string> = { fixed: "固定額（採用1名につき）" };

export function successFeeModeLabel(mode: string | null): string {
  if (mode === null) return "—";
  return SUCCESS_FEE_MODE_LABELS[mode] ?? "確認中";
}

/** 金額。null（未設定）は0円ではなく「未設定」。 */
export function yenOrUnset(amount: number | null): string {
  return amount === null ? "未設定" : `${amount.toLocaleString("ja-JP")}円`;
}

/** 日付（date型の文字列 yyyy-mm-dd、またはtimestamp）。日付のみの値はタイムゾーン変換しない。 */
export function formatContractDate(value: string | null): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
  return new Date(value).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function monthLabel(month: number): string {
  return `${month}月`;
}

/** 契約基準額と実際の請求額の差（請求額 − 基準額）。どちらかが無ければ null。意味付けはしない。 */
export function baselineDifference(baseline: number | null, feeAmount: number | null): number | null {
  if (baseline === null || feeAmount === null) return null;
  return feeAmount - baseline;
}

export function formatSignedYen(diff: number): string {
  if (diff === 0) return "±0円";
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff).toLocaleString("ja-JP")}円`;
}

export const EVENT_TYPE_LABELS: Record<string, string> = {
  created: "契約条件を登録",
  activated: "契約開始",
  updated: "内容を変更",
  suspended: "一時停止",
  cancelled: "解約",
  reactivated: "契約再開",
  fiscal_year_updated: "年度開始月を変更",
};

export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? "変更";
}

type Value = string | number | boolean | null | undefined;

const FIELD_LABELS: Record<string, string> = {
  contract_status: "契約状態",
  success_fee_amount: "成功報酬額",
  monthly_fee: "月額",
  contract_started_at: "契約開始日",
  contract_ended_at: "契約終了日",
  fiscal_year_start_month: "年度開始月",
};

function formatValue(key: string, value: Value): string {
  if (value === null || value === undefined) return "未設定";
  switch (key) {
    case "contract_status": return contractStatusLabel(String(value));
    case "success_fee_amount":
    case "monthly_fee": return typeof value === "number" ? yenOrUnset(value) : "未設定";
    case "contract_started_at":
    case "contract_ended_at": return formatContractDate(String(value));
    case "fiscal_year_start_month": return typeof value === "number" ? monthLabel(value) : "未設定";
    default: return "—";
  }
}

/** 履歴1件の変更内容を、画面に出す文にする（内部メモの本文は履歴に入っていない）。 */
export function describeEventChanges(event: AdminContractEvent): string[] {
  const lines: string[] = [];
  for (const key of Object.keys(FIELD_LABELS)) {
    const hasAfter = key in event.after_values;
    if (!hasAfter) continue;
    const after = event.after_values[key];
    if (event.event_type === "created") {
      lines.push(`${FIELD_LABELS[key]}：${formatValue(key, after)}`);
    } else {
      lines.push(`${FIELD_LABELS[key]}：${formatValue(key, event.before_values[key])} → ${formatValue(key, after)}`);
    }
  }
  if (event.after_values["note_set"] === true) lines.push("運営者メモを設定");
  if (event.after_values["note_changed"] === true) lines.push("運営者メモを変更（内容は履歴に残しません）");
  return lines;
}
