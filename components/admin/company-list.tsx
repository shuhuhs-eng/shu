"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatYen } from "@/lib/billing/format";
import { ExportCsvButton } from "@/components/analytics/export-csv-button";

export type CompanyRow = {
  organization_id: string;
  organization_name: string;
  store_count: number;
  active_store_count: number;
  candidate_count: number;
  interview_count: number;
  offered_count: number;
  hired_count: number;
  success_fee_count: number;
  pending_confirmation_count: number;
  confirmed_count: number;
  invoiced_count: number;
  paid_count: number;
  waived_count: number;
  cancelled_count: number;
  confirmed_total_amount: number | null;
  invoiced_total_amount: number | null;
  paid_total_amount: number | null;
  latest_hired_at: string | null;
  latest_activity_at: string | null;
  /** 整合性の異常の件数。null は取得できなかった（0件とは扱わない）。 */
  issue_count: number | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });
}

type FilterKey = "pending" | "unpaid" | "issue" | "hired";
const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "pending", label: "請求確認中あり" },
  { key: "unpaid", label: "未入金あり" },
  { key: "issue", label: "整合性異常あり" },
  { key: "hired", label: "採用あり" },
];

function matches(o: CompanyRow, key: FilterKey): boolean {
  switch (key) {
    case "pending": return o.pending_confirmation_count > 0;
    case "unpaid": return o.invoiced_count > 0; // 請求済みで入金前
    case "issue": return (o.issue_count ?? 0) > 0;
    case "hired": return o.hired_count > 0;
  }
}

/** 会社一覧の検索・絞り込み（取得済みのデータをこの画面内で絞るだけ。DBへは追加で問い合わせない）。 */
export function CompanyList({ companies }: { companies: CompanyRow[] }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<FilterKey[]>([]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return companies.filter((o) => (!q || o.organization_name.toLowerCase().includes(q)) && active.every((k) => matches(o, k)));
  }, [companies, query, active]);

  const toggle = (key: FilterKey) => setActive((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  return (
    <>
      <div className="mt-6 space-y-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="会社名で検索"
          aria-label="会社名で検索"
          className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-[13px]"
        />
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={active.includes(f.key)}
              onClick={() => toggle(f.key)}
              className={`rounded-full border px-3.5 py-1.5 text-[12px] font-semibold ${active.includes(f.key) ? "border-ink bg-ink text-white" : "border-line bg-surface text-charcoal"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-sub">{shown.length}社 / 全{companies.length}社</p>
          <ExportCsvButton
            filename="companies.csv"
            label="表示中の会社をCSVで保存"
            header={["会社", "店舗数", "利用中店舗", "候補者", "面談到達", "内定", "採用", "成功報酬", "請求確認中", "請求済み", "入金済み", "成功報酬総額", "請求済み総額", "入金済み総額", "直近活動日"]}
            rows={shown.map((o) => [o.organization_name, o.store_count, o.active_store_count, o.candidate_count, o.interview_count, o.offered_count, o.hired_count, o.success_fee_count, o.pending_confirmation_count, o.invoiced_count, o.paid_count, o.confirmed_total_amount, o.invoiced_total_amount, o.paid_total_amount, fmtDate(o.latest_activity_at)])}
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-line bg-surface p-8 text-center text-[13px] text-sub">条件に合う会社はありません。</p>
      ) : (
        <div className="mt-4 space-y-4">
          {shown.map((o) => (
            <article key={o.organization_id} className="rounded-2xl border border-line bg-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-serif text-lg font-bold text-ink">{o.organization_name}</h2>
                <Link href={`/admin/companies/${o.organization_id}`} className="shrink-0 text-[12px] font-semibold underline">詳細 ›</Link>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px] sm:grid-cols-6">
                {[
                  ["店舗数", o.store_count], ["利用中店舗", o.active_store_count], ["候補者", o.candidate_count],
                  ["面談到達", o.interview_count], ["内定", o.offered_count], ["採用", o.hired_count],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-surface2 p-2"><dt className="text-sub">{label}</dt><dd className="mt-0.5 text-[15px] font-bold text-ink">{value}</dd></div>
                ))}
              </dl>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px] sm:grid-cols-7">
                {[
                  ["成功報酬", o.success_fee_count], ["請求確認中", o.pending_confirmation_count], ["請求額確定", o.confirmed_count],
                  ["請求済み", o.invoiced_count], ["入金済み", o.paid_count], ["免除", o.waived_count], ["取消", o.cancelled_count],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-surface2 p-2"><dt className="text-sub">{label}</dt><dd className="mt-0.5 text-[15px] font-bold text-ink">{value}</dd></div>
                ))}
              </dl>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">成功報酬総額</dt><dd className="mt-0.5 text-[13px] font-bold">{formatYen(o.confirmed_total_amount)}</dd></div>
                <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">請求済み総額</dt><dd className="mt-0.5 text-[13px] font-bold">{formatYen(o.invoiced_total_amount)}</dd></div>
                <div className="rounded-lg bg-surface2 p-2"><dt className="text-sub">入金済み総額</dt><dd className="mt-0.5 text-[13px] font-bold">{formatYen(o.paid_total_amount)}</dd></div>
              </dl>
              <p className="mt-3 text-[11px] text-sub">
                直近採用日 {fmtDate(o.latest_hired_at)} ／ 直近活動日 {fmtDate(o.latest_activity_at)}
                {o.issue_count !== null && o.issue_count > 0 && <span className="ml-2 font-semibold text-[#8A2E2E]">整合性の異常 {o.issue_count}件</span>}
              </p>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
