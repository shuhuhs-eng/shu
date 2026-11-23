import test from "node:test";
import assert from "node:assert/strict";
import { parseOperatorState, canEnterOperations, isStaffState, operatorHomePath, STATE_PAGE_ACCEPTS, type OperatorState } from "../lib/admin/operator-state";
import { STAFF_MENU } from "../lib/admin/staff-menu";

const ALL: OperatorState[] = ["responsible", "staff_active", "staff_invited", "staff_invited_expired", "staff_suspended", "staff_relogin", "none", "error"];

test("RPCの戻り値の解釈: 既知の状態だけ通し、想定外は error", () => {
  assert.equal(parseOperatorState({ state: "staff_active", display_name: "山田" }), "staff_active");
  assert.equal(parseOperatorState({ state: "responsible" }), "responsible");
  for (const bad of [null, undefined, "staff_active", 1, [], {}, { state: 1 }, { state: "admin" }, { state: "STAFF_ACTIVE" }]) assert.equal(parseOperatorState(bad), "error", JSON.stringify(bad));
});
test("業務の画面に入れるのは責任者と有効なスタッフだけ", () => {
  assert.deepEqual(ALL.filter(canEnterOperations), ["responsible", "staff_active"]);
});
test("スタッフ判定: 招待中・有効・停止中・再ログイン待ちはスタッフ、責任者・none・error は違う", () => {
  assert.deepEqual(ALL.filter(isStaffState), ["staff_active", "staff_invited", "staff_invited_expired", "staff_suspended", "staff_relogin"]);
});
test("行き先: 状態ごとに決まり、運営でない/確認できないときは null", () => {
  assert.equal(operatorHomePath("responsible"), "/admin");
  assert.equal(operatorHomePath("staff_active"), "/admin/staff");
  assert.equal(operatorHomePath("staff_invited"), "/admin/staff/accept");
  assert.equal(operatorHomePath("staff_invited_expired"), "/admin/staff/accept");
  assert.equal(operatorHomePath("staff_suspended"), "/admin/staff/suspended");
  assert.equal(operatorHomePath("staff_relogin"), "/admin/login?relogin=1");
  assert.equal(operatorHomePath("none"), null);
  assert.equal(operatorHomePath("error"), null);
});
test("リダイレクトの輪が無い: スタッフ状態ページは、その行き先になる状態を必ず受け入れる", () => {
  for (const s of ALL) {
    const home = operatorHomePath(s);
    if (!home || !isStaffState(s) || home.startsWith("/admin/login")) continue;
    assert.ok(STATE_PAGE_ACCEPTS[home]?.includes(s), `${s} → ${home} がその状態を受け入れない`);
  }
  // 受け入れる状態は、それぞれ別のページの担当で重複しない
  const seen = new Set<string>();
  for (const [page, states] of Object.entries(STATE_PAGE_ACCEPTS)) for (const st of states) { assert.ok(!seen.has(st), `${st} が複数ページに重複 (${page})`); seen.add(st); }
});
test("スタッフのメニューは責任者専用の入口を含まない", () => {
  const forbidden = ["/admin/companies", "/admin/contracts", "/admin/success-fees", "/admin/stripe", "/admin/issuer-settings", "/admin/integrity", "/admin/evidence", "/admin/legal", "/admin/salons", "/admin/stylists", "/admin/email-outbox", "/admin/messages/new", "/admin/staff/list"];
  for (const m of STAFF_MENU) assert.ok(!forbidden.some((f) => m.href === f || m.href.startsWith(f + "/")), m.href);
  assert.equal(new Set(STAFF_MENU.map((m) => m.href)).size, STAFF_MENU.length);
});
