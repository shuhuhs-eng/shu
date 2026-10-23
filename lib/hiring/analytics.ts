import type { CompanyHiringRow } from "@/lib/hiring/company";

/**
 * 採用ファネル・経路・店舗比較・要注意表示（Phase 16〜19）の集計。
 *
 * ★すべて「現在の状態」の集計（get_store_hiring_processes の現在行）。履歴（いつ面談したか等）
 * は使わないため、一度面談に進んだあと辞退・不採用になった人は面談段階の数に含まれない。
 * 期間分析・正確な通過率には履歴を使う別の集計が必要（今回は対象外）。
 */

/** 面談設定以降の段階にいる状態（連絡調整中より先に進んでいて、まだ終了していない）。 */
const INTERVIEWED_OR_LATER = ["interview_scheduled", "interview_completed", "selection", "offered", "hired"] as const;

export type FunnelCounts = {
  candidates: number;
  interviewScheduled: number;
  interviewCompleted: number;
  selection: number;
  offered: number;
  hired: number;
  declined: number;
  rejected: number;
  /** 面談段階以降にいる人数（面談化率の分子）。 */
  progressed: number;
};

export function funnel(rows: Array<{ status: string }>): FunnelCounts {
  const n = (s: string) => rows.filter((r) => r.status === s).length;
  const progressed = rows.filter((r) => (INTERVIEWED_OR_LATER as readonly string[]).includes(r.status)).length;
  return {
    candidates: rows.length,
    interviewScheduled: n("interview_scheduled"),
    interviewCompleted: n("interview_completed"),
    selection: n("selection"),
    offered: n("offered"),
    hired: n("hired"),
    declined: n("declined"),
    rejected: n("rejected"),
    progressed,
  };
}

/** 割合の表示。分母0は「—」。 */
export function percent(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${Math.round((numerator / denominator) * 1000) / 10}%`;
}

export function rates(f: FunnelCounts): { interview: string; offer: string; hire: string } {
  return {
    interview: percent(f.progressed, f.candidates),
    offer: percent(f.offered + f.hired, f.candidates),
    hire: percent(f.hired, f.candidates),
  };
}

export const SOURCES = ["interest", "scout", "salary_offer"] as const;

export function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  return map;
}

/**
 * 要注意表示の参考日数。ビジネス仕様として確定した値ではなく、画面上の目安。
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

export type AttentionItem = {
  row: CompanyHiringRow;
  reason: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function findAttentionItems(rows: CompanyHiringRow[], now: Date = new Date()): AttentionItem[] {
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
