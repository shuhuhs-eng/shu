import type { Database } from "@/types/database";

/**
 * 会社の採用分析（0041の get_company_hiring_analytics）の型と、画面側の計算。
 *
 * ★件数は履歴ベース（一度でも到達した段階）。辞退・不採用になっても、過去に到達した
 * 段階は保持される。割合は件数から計算する（分母0は「—」）。
 */
type Analytics = Database["public"]["Functions"]["get_company_hiring_analytics"]["Returns"];
export type FunnelTotal = Analytics["total"];
export type SourceRow = Analytics["by_source"][number];
export type StoreRow = Analytics["by_store"][number];
export type AttentionRow = Analytics["attention"][number];

/** 割合の表示。分母0は「—」。 */
export function percent(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${Math.round((numerator / denominator) * 1000) / 10}%`;
}

/** 棒グラフ用の幅(0〜100)。分母0は0。 */
export function barWidth(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

export const SOURCES = ["interest", "scout", "salary_offer"] as const;

/**
 * 要確認表示の参考日数。ビジネス仕様として確定した値ではなく、画面上の目安。
 * DBには持たない。変更したい場合はここだけを変える。
 */
export const ATTENTION_THRESHOLD_DAYS = {
  /** 連絡調整中のまま更新が無い */
  contacting: 7,
  /** 面談済み・選考中のまま更新が無い */
  inProgress: 14,
  /** 内定のまま更新が無い */
  offered: 14,
} as const;

export type AttentionItem = { row: AttentionRow; reason: string };

const DAY_MS = 24 * 60 * 60 * 1000;

export function findAttentionItems(rows: AttentionRow[], now: Date = new Date()): AttentionItem[] {
  const items: AttentionItem[] = [];
  const daysSince = (iso: string) => Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);
  for (const row of rows) {
    if (row.status === "interview_scheduled" && row.interview_at && new Date(row.interview_at).getTime() < now.getTime()) {
      items.push({ row, reason: "面談予定日を過ぎています（状態が更新されていません）" });
    } else if (row.status === "contacting" && daysSince(row.updated_at) >= ATTENTION_THRESHOLD_DAYS.contacting) {
      items.push({ row, reason: `連絡調整中のまま${daysSince(row.updated_at)}日更新がありません` });
    } else if (
      (row.status === "interview_completed" || row.status === "selection") &&
      daysSince(row.updated_at) >= ATTENTION_THRESHOLD_DAYS.inProgress
    ) {
      items.push({ row, reason: `選考中のまま${daysSince(row.updated_at)}日更新がありません` });
    } else if (row.status === "offered" && daysSince(row.updated_at) >= ATTENTION_THRESHOLD_DAYS.offered) {
      items.push({ row, reason: `内定のまま${daysSince(row.updated_at)}日更新がありません` });
    }
  }
  return items.sort((a, b) => a.row.updated_at.localeCompare(b.row.updated_at));
}

// ---- 期間別（0042） ----
type PeriodFns = Database["public"]["Functions"];
export type ActivityResult = PeriodFns["get_company_hiring_period_analytics"]["Returns"];
export type CohortResult = PeriodFns["get_company_hiring_cohort_analytics"]["Returns"];
export type CohortTotal = CohortResult["cohort"];
export type CohortSourceRow = CohortResult["by_source"][number];
export type CohortStoreRow = CohortResult["by_store"][number];

/** 差分の表示（+3 / -1 / ±0）。 */
export function diffLabel(current: number, previous: number): string {
  const d = current - previous;
  if (d === 0) return "±0";
  return d > 0 ? `+${d}` : `${d}`;
}

/** 割合の差(ポイント)の表示。どちらかが「—」なら「—」。 */
export function ratePointDiff(curNum: number, curDen: number, prevNum: number, prevDen: number): string {
  if (curDen <= 0 || prevDen <= 0) return "—";
  const d = Math.round(((curNum / curDen) - (prevNum / prevDen)) * 1000) / 10;
  if (d === 0) return "±0pt";
  return d > 0 ? `+${d}pt` : `${d}pt`;
}

// ---- CSV（集計値と店舗名・入口名だけ。個人名・社内メモ・IDは含めない） ----
export const COHORT_CSV_HEADER = ["区分", "名称", "候補者", "面談化", "面談実施", "選考", "内定", "採用", "辞退", "不採用", "採用率(%)"];
const CSV_SOURCE_LABELS: Record<string, string> = { interest: "興味あり", scout: "スカウト", salary_offer: "給与オファー" };

function rateNumber(n: number, d: number): string {
  return d <= 0 ? "" : String(Math.round((n / d) * 1000) / 10);
}

export function cohortCsvRows(cohort: CohortResult): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [];
  for (const s of cohort.by_source) {
    rows.push(["入口別", CSV_SOURCE_LABELS[s.source] ?? s.source, s.candidate_count, s.interview_reached_count, s.interview_completed_count, "", s.offered_count, s.hired_count, "", "", rateNumber(s.hired_count, s.candidate_count)]);
  }
  for (const st of cohort.by_store) {
    rows.push(["店舗別", st.store_name, st.candidate_count, st.interview_reached_count, st.interview_completed_count, st.selection_count, st.offered_count, st.hired_count, st.declined_count, st.rejected_count, rateNumber(st.hired_count, st.candidate_count)]);
  }
  return rows;
}
