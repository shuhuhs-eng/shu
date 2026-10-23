/**
 * 期間分析の期間境界（日本時間基準）。DBには年度開始月などを持たせず、ここで決める。
 *
 * ★境界は JST(UTC+9、夏時間なし) の月初 00:00 を UTC の ISO 文字列にしたもの。
 * 画面に出す期間の表示と、RPC に渡す p_from / p_to が同じ値から作られるのでずれない。
 * RPC の期間は p_from <= created_at < p_to（終了は含まない）。
 */

/** 年度の開始月（1〜12）。UI側の定数。会社ごとの年度設定は後続Phase。 */
export const FISCAL_YEAR_START_MONTH = 4;

export const PERIOD_KEYS = ["this_month", "last_month", "last_3_months", "fiscal_year", "all"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  this_month: "今月",
  last_month: "先月",
  last_3_months: "直近3ヶ月",
  fiscal_year: "年度",
  all: "全期間",
};

export function isPeriodKey(value: string | undefined): value is PeriodKey {
  return !!value && (PERIOD_KEYS as readonly string[]).includes(value);
}

export type Period = {
  key: PeriodKey;
  /** 例: 2026年10月 / 2026年8月〜10月 / 2026年度（4月〜翌3月） */
  rangeLabel: string;
  /** RPCの p_from（含む）。 */
  from: string;
  /** RPCの p_to（含まない）。 */
  to: string;
};

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** JSTの year / month(0始まり) の月初 00:00 を表す Date（UTC基準の瞬間）。month は範囲外でもよい（年をまたぐ）。 */
function jstMonthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1) - JST_OFFSET_MS);
}

function jstYearMonth(now: Date): { year: number; month: number } {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return { year: jst.getUTCFullYear(), month: jst.getUTCMonth() };
}

function monthLabel(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 1));
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月`;
}

function span(key: PeriodKey, fromY: number, fromM: number, toY: number, toM: number, rangeLabel: string): Period {
  return {
    key,
    rangeLabel,
    from: jstMonthStart(fromY, fromM).toISOString(),
    to: jstMonthStart(toY, toM).toISOString(),
  };
}

/** 年度の開始年（その時点が属する年度の4月1日の年）。 */
function fiscalYearStartYear(now: Date): number {
  const { year, month } = jstYearMonth(now);
  return month + 1 >= FISCAL_YEAR_START_MONTH ? year : year - 1;
}

/** 指定した期間（`offset` 期間ぶん前を 1, 2, … と指定。0 が今の期間）。全期間は比較対象なし(null)。 */
export function resolvePeriod(key: PeriodKey, now: Date = new Date(), offset = 0): Period | null {
  const { year, month } = jstYearMonth(now);
  switch (key) {
    case "this_month":
    case "last_month": {
      const base = key === "this_month" ? month : month - 1;
      const m = base - offset;
      return span(key, year, m, year, m + 1, monthLabel(year, m));
    }
    case "last_3_months": {
      // 今月を含む3ヶ月（例: 10月なら8月〜10月）。
      const endExclusive = month + 1 - offset * 3;
      const startM = endExclusive - 3;
      const startLabel = monthLabel(year, startM);
      const endDate = new Date(Date.UTC(year, endExclusive - 1, 1));
      return span(key, year, startM, year, endExclusive, `${startLabel}〜${endDate.getUTCMonth() + 1}月`);
    }
    case "fiscal_year": {
      const startYear = fiscalYearStartYear(now) - offset;
      const startMonth = FISCAL_YEAR_START_MONTH - 1;
      return span(
        key,
        startYear,
        startMonth,
        startYear + 1,
        startMonth,
        `${startYear}年度（${FISCAL_YEAR_START_MONTH}月〜翌${((FISCAL_YEAR_START_MONTH + 10) % 12) + 1}月）`,
      );
    }
    case "all": {
      if (offset > 0) return null;
      // 来月初まで（今後の予定は含まれない）。開始は十分に古い日付。
      return { key, rangeLabel: "これまでのすべて", from: jstMonthStart(2000, 0).toISOString(), to: jstMonthStart(year, month + 1).toISOString() };
    }
  }
}
