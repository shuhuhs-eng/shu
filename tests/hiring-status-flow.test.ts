import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HIRING_STATUS_LABELS, allowedNextStatuses, statusActionLabel, stylistStatusLabel,
} from "../lib/hiring/format";
import { COHORT_CSV_HEADER, cohortCsvRows, findAttentionItems } from "../lib/hiring/analytics";

const read = (f: string) => readFileSync(f, "utf8");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("G: 選考中から出せる操作に『採用にする』があり、『内定』は出ない", () => {
  const next = allowedNextStatuses("selection");
  assert.ok(next.includes("hired"));
  assert.ok(!next.includes("offered"));
  assert.equal(statusActionLabel("selection", "hired"), "採用にする");
  assert.ok(!allowedNextStatuses("interview_completed").includes("offered"));
});

test("F: 新UIの操作・フローに『内定』が出ない（過去データのofferedだけ互換で残る）", () => {
  for (const from of ["contacting", "interview_scheduled", "interview_completed", "selection", "declined", "rejected", "hired"]) {
    assert.ok(!allowedNextStatuses(from).includes("offered"), from);
  }
  // 過去データ: 内定は「選考中（旧：内定）」と明示し、「採用」とは偽装しない。美容師側は選考中と表示。
  assert.equal(HIRING_STATUS_LABELS.offered, "選考中（旧：内定）");
  assert.notEqual(HIRING_STATUS_LABELS.offered, HIRING_STATUS_LABELS.hired);
  assert.equal(stylistStatusLabel("offered"), "選考中");
  assert.ok(!/内定/.test(stylistStatusLabel("offered")));
  assert.equal(stylistStatusLabel("hired"), "採用");
  // 過去のofferedは正式に「採用にする」を押した時だけ採用へ進める。
  assert.ok(allowedNextStatuses("offered").includes("hired"));
  assert.deepEqual(allowedNextStatuses("hired"), []);
});

test("F: 店舗UI/サーバーアクションから新規の内定操作が無い", () => {
  const actions = strip(read("lib/hiring/actions.ts"));
  assert.ok(!/toStatus: z\.enum\(\[[^\]]*"offered"/.test(actions));
  const panel = strip(read("components/hiring/status-panel.tsx"));
  assert.ok(!/内定/.test(panel));
  const card = strip(read("components/hiring/stylist-application-card.tsx"));
  assert.ok(!/から内定が出/.test(card));
});

test("H: 採用確定の前に確認ダイアログ（キャンセル／採用を確定）が出る", () => {
  const panel = read("components/hiring/status-panel.tsx");
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /この美容師を採用にしますか？/);
  assert.match(panel, /採用を確定すると成功報酬の請求対象になります/);
  assert.match(panel, /キャンセル/);
  assert.match(panel, /採用を確定/);
  // 「採用にする」を押しても、確認ダイアログを開くだけで直接は送信しない。
  assert.match(panel, /selected === "hired" \? setConfirmOpen\(true\) : submit\(\)/);
  assert.match(panel, /onClick=\{submit\}/);
});

test("K: 採用分析・CSV・管理画面から『内定』の列/項目を外す", () => {
  assert.ok(!COHORT_CSV_HEADER.includes("内定"));
  const row = cohortCsvRows({
    cohort: {}, by_source: [{ source: "scout", candidate_count: 4, interview_reached_count: 3, interview_completed_count: 2, selection_count: 1, offered_count: 9, hired_count: 1, declined_count: 0, rejected_count: 0 }],
    by_store: [{ store_name: "渋谷店", candidate_count: 4, interview_reached_count: 3, interview_completed_count: 2, selection_count: 1, offered_count: 9, hired_count: 1, declined_count: 0, rejected_count: 0 }],
  } as never);
  for (const r of row) assert.equal(r.length, COHORT_CSV_HEADER.length);
  assert.ok(row.every((r) => !r.includes(9)), "offered_count（採用と同数になる旧項目）はCSVに出さない");
  for (const f of ["app/salon/company/analytics/page.tsx", "app/salon/company/page.tsx", "app/admin/companies/page.tsx", "app/admin/companies/[organizationId]/page.tsx", "components/admin/company-list.tsx"]) {
    const t = strip(read(f));
    assert.ok(!/内定/.test(t) && !/offered_count/.test(t.replace(/offered_count: number;/g, "")), f);
  }
  const hiring = read("app/salon/company/hiring/page.tsx");
  assert.ok(!/label: "内定"/.test(hiring));
});

test("K: 過去のoffered（未採用）は要確認として選考中扱いで検出し、採用とは数えない", () => {
  const items = findAttentionItems(
    [{ status: "offered", updated_at: "2026-01-01T00:00:00Z" } as never],
    new Date("2026-02-01T00:00:00Z"),
  );
  assert.equal(items.length, 1);
  assert.match(items[0]!.reason, /選考中（旧：内定）/);
});

test("0052: 既存migrationを変更せず、offeredを一括更新せず、成功報酬・通知・Stripeに触れない", () => {
  const sql = strip(read("supabase/migrations/0052_simplify_hiring_status_flow.sql").replace(/^\s*--.*$/gm, ""));
  assert.match(sql, /function public\.hiring_transition_allowed/);
  assert.match(sql, /function public\.hiring_stage_rank/);
  assert.ok(!/update\s+public\.store_hiring_processes|delete\s+from|drop\s+/i.test(sql), "データを更新・削除しない");
  assert.ok(!/hiring_success_fee|stripe|notifications|notify_on_hiring_event/i.test(sql), "成功報酬・Stripe・通知トリガーは再定義しない");
  assert.match(sql, /'selection'\s+then p_to in \('interview_scheduled', 'hired'/);
  assert.match(sql, /'offered'\s+then p_to in \('selection', 'hired', 'rejected', 'declined'\)/);
});
