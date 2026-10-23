import type { Database } from "@/types/database";

export type BillingIntegrityIssue = Database["public"]["Functions"]["get_admin_billing_integrity_issues"]["Returns"][number];

/** 画面に出す日本語。issue_type（内部名）はそのまま表示しない。 */
export const ISSUE_TYPE_LABELS: Record<string, string> = {
  missing_success_fee: "成功報酬記録なし",
  process_not_hired: "採用状態不一致",
  store_mismatch: "店舗情報不一致",
  stylist_mismatch: "美容師情報不一致",
  hired_at_mismatch: "採用成立日不一致",
  event_status_mismatch: "履歴状態不一致",
};

export function issueTypeLabel(type: string): string {
  return ISSUE_TYPE_LABELS[type] ?? "その他の不整合";
}

export function severityLabel(severity: string): string {
  return severity === "critical" ? "要対応" : "要確認";
}

export function countSeverities(issues: Array<{ severity: string }>): { total: number; critical: number; warning: number } {
  const critical = issues.filter((i) => i.severity === "critical").length;
  return { total: issues.length, critical, warning: issues.length - critical };
}
