import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ledgerSendErrorMessage, makeRequestIdHolder, nextSendMode, isUnknownOutcome, NOTHING_DONE_HINT } from "../lib/billing/scout-send-rules";

test("残高不足などを利用者向けの文言にする（内部名は出さない）", () => {
  assert.equal(ledgerSendErrorMessage("ERROR: insufficient scout balance"), "スカウトの残数が足りません。");
  assert.ok(!/台帳|ledger|consume/i.test(ledgerSendErrorMessage("consume order is undecided") ?? ""));
  assert.equal(ledgerSendErrorMessage("something else"), null);
});
test("再試行キー: 同じ内容は同じキー・内容が変われば新しいキー・成功後は捨てる", () => {
  let n = 0; const h = makeRequestIdHolder(() => `id${++n}`);
  assert.equal(h.get("a"), "id1"); assert.equal(h.get("a"), "id1");
  assert.equal(h.get("b"), "id2");
  h.reset(); assert.equal(h.get("b"), "id3");
});
test("送信処理: フラグ'1'のときだけ台帳方式。既定は従来のsend_scout_v2のまま。キーは送信ごとに渡す", () => {
  const a = readFileSync("lib/scouts/actions.ts", "utf8");
  assert.match(a, /scoutLedgerEnabled\(\)/);
  assert.match(a, /"send_scout_with_ledger"/);
  assert.match(a, /supabase\.rpc\("send_scout_v2", args\)/);
  assert.match(a, /p_request_id: requestId/); assert.match(a, /const requestId = parsed\.data\.requestId \?\? randomUUID\(\)/);
  const c = readFileSync("components/scouts/store-stylist-card.tsx", "utf8");
  assert.match(c, /requestId: requestIds\.current\.get\(/);
});

test("方式の食い違いは、DBが『何もしていない』と明示したときだけ逆の方式でやり直す", () => {
  const hint = NOTHING_DONE_HINT;
  assert.equal(nextSendMode({ message: "legacy scout sending is closed", code: "P0001", hint }, false), true);
  assert.equal(nextSendMode({ message: "ledger scout sending is not active", code: "P0001", hint }, true), false);
  assert.equal(nextSendMode({ message: "legacy scout sending is closed", code: "P0001", hint }, true), null);
  assert.equal(nextSendMode({ message: "legacy scout sending is closed", code: "P0001", hint: null }, false), null);   // 印が無ければやり直さない
  assert.equal(nextSendMode({ message: "legacy scout sending is closed" }, false), null);
  assert.equal(nextSendMode({ message: "insufficient scout balance", code: "P0001", hint }, true), null);
  assert.equal(nextSendMode({ message: "scout sending is paused", code: "P0001", hint }, true), null);   // 一時停止は別の方式でも送らない
  assert.ok(ledgerSendErrorMessage("legacy scout sending is closed")); assert.ok(ledgerSendErrorMessage("scout sending is paused"));
});
test("結果が分からない失敗（通信切れ・タイムアウト）は別の方式で送り直さない", () => {
  assert.equal(isUnknownOutcome({ message: "fetch failed" }, false), true);          // DBのコード無し
  assert.equal(isUnknownOutcome(null, true), true);                                  // 例外
  assert.equal(isUnknownOutcome({ message: "insufficient scout balance", code: "P0001" }, false), false);   // DBが「できなかった」と返した
  assert.equal(isUnknownOutcome(null, false), false);
  assert.equal(nextSendMode({ message: "fetch failed" }, false), null);
});
test("送信前にDBの送信方式を読む（フラグ'1'のときだけ）・残数表示は共通部品", () => {
  const a = readFileSync("lib/scouts/actions.ts", "utf8");
  assert.match(a, /if \(flagOn\) \{\s*const \{ data: mode \} = await supabase\.rpc\("scout_send_mode"/);
  assert.match(a, /nextSendMode\(error, ledger\)/); assert.match(a, /scout_send_result/);
  const c = readFileSync("components/store-activity/scout-allowance.tsx", "utf8");
  assert.match(c, /scoutLedgerEnabled\(\)/); assert.match(c, /mode !== "ledger"/); assert.match(c, /scout_ledger_balance_for_store/);
  assert.match(readFileSync("app/salon/stores/[storeId]/page.tsx", "utf8"), /<ScoutAllowance storeId=\{storeId\}/);
});
