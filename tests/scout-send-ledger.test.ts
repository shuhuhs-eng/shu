import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ledgerSendErrorMessage, makeRequestIdHolder, nextSendMode } from "../lib/billing/scout-send-rules";

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

test("切替の途中で方式が食い違ったときだけ、逆の方式で1回やり直す", () => {
  assert.equal(nextSendMode("legacy scout sending is closed", false), true);
  assert.equal(nextSendMode("ledger scout sending is not active", true), false);
  assert.equal(nextSendMode("legacy scout sending is closed", true), null);
  assert.equal(nextSendMode("insufficient scout balance", true), null);
  assert.ok(ledgerSendErrorMessage("legacy scout sending is closed"));
});
test("送信前にDBの送信方式を読む（フラグ'1'のときだけ）・残数表示は共通部品", () => {
  const a = readFileSync("lib/scouts/actions.ts", "utf8");
  assert.match(a, /if \(flagOn\) \{\s*const \{ data: mode \} = await supabase\.rpc\("scout_send_mode"/);
  assert.match(a, /nextSendMode\(error\.message, ledger\)/);
  const c = readFileSync("components/store-activity/scout-allowance.tsx", "utf8");
  assert.match(c, /scoutLedgerEnabled\(\)/); assert.match(c, /mode !== "ledger"/); assert.match(c, /scout_ledger_balance_for_store/);
  assert.match(readFileSync("app/salon/stores/[storeId]/page.tsx", "utf8"), /<ScoutAllowance storeId=\{storeId\}/);
});
