import { test } from "node:test";
import assert from "node:assert/strict";
import { addThreeMonthsJst, confirmNotice, formatJstDate, formatJstDateTime, mapLimitError, parseLimitStatus } from "../lib/diagnosis-limit/messages";
import { isMissingFunctionError } from "../lib/diagnosis-limit/commit";

test("日本時間の暦で3か月後（月末は月内に丸める。DBの規則と同じ）", () => {
  // 2026-11-13 18:10 JST = 09:10Z → 2027-02-13 18:10 JST
  assert.equal(addThreeMonthsJst(new Date("2026-11-13T09:10:00Z")).toISOString(), "2027-02-13T09:10:00.000Z");
  // 11/30 → 2/28（うるう年でない）
  assert.equal(formatJstDate(addThreeMonthsJst(new Date("2026-11-30T03:00:00Z"))), "2027年2月28日");
  // 日本時間では翌日になる時刻（UTC 11/29 16:00 = JST 11/30 01:00）でも、日本の暦で数える
  assert.equal(formatJstDate(addThreeMonthsJst(new Date("2026-11-29T16:00:00Z"))), "2027年2月28日");
  // 11/30 → うるう年の 2/29
  assert.equal(formatJstDate(addThreeMonthsJst(new Date("2027-11-30T03:00:00Z"))), "2028年2月29日");
  // 年またぎ
  assert.equal(formatJstDate(addThreeMonthsJst(new Date("2026-10-31T03:00:00Z"))), "2027年1月31日");
});

test("日時の表示は日本時間", () => {
  assert.equal(formatJstDateTime("2027-02-13T09:10:00Z"), "2027年2月13日 18時10分");
});

test("状態の読み取り: 想定外の形は unknown（案内を出さないだけ）", () => {
  assert.equal(parseLimitStatus(null).state, "unknown");
  assert.equal(parseLimitStatus({ state: "locked" }).state, "unknown", "locked なのに日時が無い");
  assert.equal(parseLimitStatus({ state: "locked", locked_until: "x" }).state, "unknown");
  assert.deepEqual(parseLimitStatus({ state: "locked", locked_until: "2027-02-13T09:10:00Z", change_count: 1 }), { state: "locked", lockedUntil: "2027-02-13T09:10:00Z", changeCount: 1 });
  assert.equal(parseLimitStatus({ state: "none" }).state, "none");
  assert.equal(parseLimitStatus({ state: "can_change", change_count: 1 }).state, "can_change");
});

test("確認画面の案内: 初回／変更できる／ロック中／不明", () => {
  const now = new Date("2026-11-13T09:10:00Z");
  const none = confirmNotice({ state: "none", lockedUntil: null, changeCount: 0 }, now);
  assert.equal(none.blocking, false);
  assert.ok(none.lines.join("").includes("1回だけ"));
  const can = confirmNotice({ state: "can_change", lockedUntil: null, changeCount: 1 }, now);
  assert.equal(can.blocking, false);
  assert.ok(can.lines.join("").includes("2027年2月13日"), "保存すると◯日以降まで変更できない、を事前に示す");
  const locked = confirmNotice({ state: "locked", lockedUntil: "2027-02-13T09:10:00Z", changeCount: 1 }, now);
  assert.equal(locked.blocking, true);
  assert.ok(locked.lines[0].includes("2027年2月13日 18時10分"));
  const unk = confirmNotice({ state: "unknown", lockedUntil: null, changeCount: 0 }, now);
  assert.deepEqual(unk, { lines: [], blocking: false });
});

test("制限エラーの表示: DBのエラーを利用者向けの文言に直す。失敗時は回数を消費していないと伝える", () => {
  const locked = mapLimitError({ message: "diagnosis_change_locked", details: "2027-02-13T09:10:00Z" });
  assert.equal(locked.code, "locked");
  assert.equal(locked.lockedUntil, "2027-02-13T09:10:00Z");
  assert.ok(locked.message.includes("2027年2月13日 18時10分") && locked.message.includes("数えていません"));
  assert.equal(mapLimitError({ message: "diagnosis_change_locked" }).lockedUntil, null);
  const table: Array<[string, string]> = [
    ["diagnosis_already_saved", "already_saved"],
    ["diagnosis_use_confirm", "use_confirm"],
    ["request id content mismatch", "content_mismatch"],
    ["request id reused", "request_reused"],
    ["draft_changed", "draft_changed"],
    ["extra answers required", "extra_required"],
    ["draft incomplete", "draft_incomplete"],
    ["not allowed to edit this store", "not_allowed"],
    ["not authenticated", "not_authenticated"],
    ["something else entirely", "unknown"],
  ];
  for (const [m, code] of table) {
    const e = mapLimitError({ message: `ERROR: ${m}` });
    assert.equal(e.code, code, m);
    assert.ok(e.message.length > 0 && !e.message.includes("diagnosis_") && !e.message.includes("request id"), "内部の語を画面に出さない: " + m);
  }
  assert.equal(mapLimitError(null).code, "unknown");
});

test("関数が無い（0058未適用）エラーの判定は、この関数の欠落だけ", () => {
  const name = "commit_diagnosis_result";
  assert.equal(isMissingFunctionError({ code: "PGRST202", message: `Could not find the function public.${name}(p_user_id) in the schema cache` }), true);
  assert.equal(isMissingFunctionError({ code: "42883", message: `function public.${name}(uuid) does not exist` }), true);
  // 関数名だけ・コードだけでは真にならない
  assert.equal(isMissingFunctionError({ message: `Could not find the function public.${name}` }), false);
  assert.equal(isMissingFunctionError({ code: "PGRST202", message: "Could not find the function public.other_fn(x)" }), false, "別の関数の欠落");
  assert.equal(isMissingFunctionError({ code: "42501", message: `permission denied for function ${name}` }), false, "権限エラー");
  assert.equal(isMissingFunctionError({ message: "diagnosis_change_locked", code: "P0001" }), false);
  assert.equal(isMissingFunctionError({ message: "fetch failed" }), false, "通信失敗");
  assert.equal(isMissingFunctionError(null), false);
});

import { mapLimitError as mapBusy } from "../lib/diagnosis-limit/messages";
test("競合（デッドロック・直列化失敗）の文言: 保存できなかったこと・回数に数えていないこと・もう一度保存できることを伝える", () => {
  for (const e of [{ code: "40P01", message: "deadlock detected" }, { code: "40001", message: "x" }, { message: "ERROR: deadlock detected" }]) {
    const m = mapBusy(e);
    assert.equal(m.code, "busy");
    assert.ok(m.message.includes("数えていません") && m.message.includes("もう一度保存してください"));
  }
  assert.equal(mapBusy({ message: "diagnosis_change_locked" }).code, "locked"); // 他のエラーは従来どおり
});
