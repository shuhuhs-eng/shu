/** 対応記録の表示用の整形（純粋関数・画面とテストで共有）。担当者・実対応者・入力者・代理付記の理由を名前で出す。停止したスタッフの過去記録も残す。 */
export type OperatorEntry = { user_id: string; display_name: string; role: "staff" | "responsible"; status: "active" | "suspended" };
export type WorkRecord = {
  domain: string; action: string; entity_type: string; entity_id: string; assignee_at_time: string | null;
  performed_by: string | null; entered_by: string | null; operator: string | null; proxy_reason: string | null;
  occurred_at: string; entered_at: string; legacy_shared: boolean;
};
export type WorkLogRow = {
  key: string; occurredAt: string; actionLabel: string; assigneeName: string | null; performedName: string; enteredName: string; proxyReason: string | null; proxied: boolean; legacy: boolean;
};

const isStr = (v: unknown): v is string => typeof v === "string";
const optStr = (v: unknown) => v == null || isStr(v);
export function isOperatorList(d: unknown): d is OperatorEntry[] {
  return Array.isArray(d) && d.every((x) => x && typeof x === "object" && isStr((x as OperatorEntry).user_id) && isStr((x as OperatorEntry).display_name)
    && ((x as OperatorEntry).role === "staff" || (x as OperatorEntry).role === "responsible") && ((x as OperatorEntry).status === "active" || (x as OperatorEntry).status === "suspended"));
}
export function isWorkRecordList(d: unknown): d is WorkRecord[] {
  return Array.isArray(d) && d.every((x) => x && typeof x === "object" && isStr((x as WorkRecord).action) && isStr((x as WorkRecord).occurred_at)
    && optStr((x as WorkRecord).performed_by) && optStr((x as WorkRecord).entered_by) && optStr((x as WorkRecord).proxy_reason) && optStr((x as WorkRecord).assignee_at_time));
}

export const WORK_ACTION_LABELS: Record<string, string> = {
  "visit_intake/claimed": "受付を引き受けた", "visit_intake/assignee_changed": "担当を変更", "visit_intake/details_updated": "内部メモ・詳細を更新", "visit_intake/reviewing": "確認中にした",
  "visit_schedule/scheduling": "日程調整に進めた", "visit_schedule/scheduled": "日程を確定", "visit_schedule/schedule_updated": "日程を変更",
  "visit_attendance/visit_check_started": "実施後の確認を開始", "visit_attendance/confirmation_recorded": "双方確認を記録", "visit_attendance/attended": "実施済みにした",
  "visit_attendance/closed": "受付を終了", "visit_attendance/auto_closed_duplicate": "重複のため自動で終了",
};
export const workActionLabel = (domain: string, action: string) => WORK_ACTION_LABELS[`${domain}/${action}`] ?? `${domain}/${action}`;

/** 名前の解決。停止中のスタッフは「（停止中）」を付けて残す。一覧に無い（退職・削除など）は「不明な担当者」。 */
export function nameOf(id: string | null | undefined, ops: OperatorEntry[]): string {
  if (!id) return "（なし）";
  const o = ops.find((x) => x.user_id === id);
  if (!o) return "不明な担当者";
  return o.status === "suspended" ? `${o.display_name}（停止中）` : o.display_name;
}
export function buildWorkLog(records: WorkRecord[], ops: OperatorEntry[]): WorkLogRow[] {
  return records.map((r, i) => {
    if (r.legacy_shared) {
      return { key: `${i}`, occurredAt: r.occurred_at, actionLabel: workActionLabel(r.domain, r.action), assigneeName: null, performedName: "共有アカウント時代（個人は不明）", enteredName: "共有アカウント時代（個人は不明）", proxyReason: null, proxied: false, legacy: true };
    }
    const performed = r.performed_by, entered = r.entered_by;
    return {
      key: `${i}`, occurredAt: r.occurred_at, actionLabel: workActionLabel(r.domain, r.action),
      assigneeName: r.assignee_at_time ? nameOf(r.assignee_at_time, ops) : null,
      performedName: nameOf(performed, ops), enteredName: nameOf(entered, ops),
      proxyReason: r.proxy_reason, proxied: !!performed && !!entered && performed !== entered, legacy: false,
    };
  });
}
/** 担当変更の選択肢。有効な運営（責任者＋有効なスタッフ）だけ。停止中は選べない（過去記録の表示には残る）。 */
export function assigneeOptions(ops: OperatorEntry[], currentId: string | null): { id: string; label: string }[] {
  const active = ops.filter((o) => o.status === "active").map((o) => ({ id: o.user_id, label: `${o.display_name}${o.role === "responsible" ? "（責任者）" : ""}` }));
  if (currentId && !active.some((a) => a.id === currentId)) active.unshift({ id: currentId, label: `${nameOf(currentId, ops)}（現在の担当・変更後は選べません）` });
  return active;
}
