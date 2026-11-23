import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NEXT_STATUSES, STATUS_LABELS, KIND_LABELS, ENTRANCE_LABELS, VISIT_STATUSES, isVisitList, isVisitDetail, visitErrorMessage } from "../lib/admin/visit-requests-shared";

test("遷移の目安はDBの規則と同じ: 実施済み・終了からは進めない／日程確定の前に実施後確認へは進めない", () => {
  assert.deepEqual(NEXT_STATUSES.attended, []);
  assert.deepEqual(NEXT_STATUSES.closed, []);
  assert.ok(!NEXT_STATUSES.received.includes("scheduled"));
  assert.ok(!NEXT_STATUSES.scheduling.includes("attended"));
  assert.ok(NEXT_STATUSES.post_visit_check.includes("attended"));
  assert.ok(NEXT_STATUSES.scheduled.includes("scheduled"), "日程確定のまま日付だけ変更できる");
  for (const s of VISIT_STATUSES) assert.ok(STATUS_LABELS[s]);
});
test("見学と体験入店・入口は区別して表示する", () => {
  assert.notEqual(KIND_LABELS.visit, KIND_LABELS.trial);
  assert.notEqual(ENTRANCE_LABELS.scout_reply, ENTRANCE_LABELS.direct_interest);
});
test("戻り値の検証: 想定外の形は取得失敗扱い（0件にしない）", () => {
  assert.equal(isVisitList(null), false);
  assert.equal(isVisitList({ total: 1, rows: [{ entrance: "x" }] }), false);
  assert.equal(isVisitList({ total: 0, rows: [] }), true);
  assert.equal(isVisitDetail({ id: "a" }), false);
});
test("DBの英語メッセージを運営向けの日本語にする。未知の文は汎用文（内部情報を出さない）", () => {
  assert.match(visitErrorMessage("request was updated by someone else"), /他の担当者/);
  assert.match(visitErrorMessage("both parties must confirm the visit was held"), /両方/);
  assert.match(visitErrorMessage("the same visit is already completed; close this request as duplicate"), /実施済み/);
  assert.match(visitErrorMessage("source is not a visit or trial request"), /過去の/);
  assert.doesNotMatch(visitErrorMessage("duplicate key value violates unique constraint foo"), /constraint|foo/);
});
test("受付・更新の画面は請求・決済・スカウト消費のRPCを呼ばない／相手向けの経路を作らない", () => {
  const src = ["lib/admin/visit-requests.ts", "lib/admin/visit-requests-actions.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
  assert.doesNotMatch(src, /admin_add_fee_line|admin_create_invoice|billing_|stripe|send_scout|notifications/);
  const rpcs = [...src.matchAll(/(?:rpc\()\s*"([a-z_]+)"|call<[^>]*>\(supabase, "([a-z_]+)"|rpc\("([a-z_]+)"/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  assert.ok(rpcs.length >= 4);
  for (const r of rpcs) assert.match(r, /^admin_(list|get|claim|update|record|assign|create)_visit/);
  // 相手向けの経路は『案件起点の連絡』だけ。宛先は案件からDBが確定し、呼び出しに宛先ID・会社・店舗の引数は無い。
  const create = src.slice(src.indexOf("admin_create_visit_thread") - 40);
  assert.doesNotMatch(create.split("\n")[0], /p_recipient|p_organization|p_store/);
  assert.doesNotMatch(src, /admin_create_thread"/);
  const schema = src.slice(src.indexOf("const threadSchema"), src.indexOf("export async function createVisitThread"));
  assert.doesNotMatch(schema, /recipient|organization|store/i);
});
test("過去の返信（interested）は受付ボタンを出さない（画面の分岐を静的に確認）", () => {
  const page = readFileSync("app/admin/visit-requests/page.tsx", "utf8");
  assert.match(page, /legacy_interested[\s\S]*受付できません/);
});
