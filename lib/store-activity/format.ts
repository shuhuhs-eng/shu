/** 店舗側の履歴画面で使う表示用ヘルパー（サーバーのタイムゾーンに依存しないよう日本時間で表示する）。 */
export function formatJstDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const SALARY_OFFER_STATUS_LABELS: Record<string, string> = {
  pending: "回答待ち",
  accepted: "承諾",
  revision_requested: "条件を相談",
  declined: "辞退",
  withdrawn: "取り下げ",
};

export const SALARY_OFFER_REASON_LABELS: Record<string, string> = {
  workdays: "勤務日数・休日",
  guarantee_period: "保証期間",
  role: "役割・業務範囲",
  performance_basis: "実績の評価方法",
  other: "その他",
};

export const SCOUT_READ_LABELS: Record<string, string> = {
  unread: "未読",
  read: "既読",
};
