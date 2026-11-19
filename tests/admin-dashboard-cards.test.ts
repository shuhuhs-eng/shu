import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAmountCards,
  buildContractCards,
  buildCountCards,
  buildDailyCards,
  cardValueText,
  FETCH_FAILED_TEXT,
} from "../lib/admin/dashboard-cards";

/* eslint-disable @typescript-eslint/no-explicit-any */
const fee = (o: Record<string, unknown>) => ({ fee_id: "f", fee_status: "pending_confirmation", total_amount: 0, due_date: null, invoice_number: null, fee_amount: null, contract_success_fee_amount: null, ...o }) as any;
const contract = (status: string | null, amount: number | null = 100) => ({ organization_id: "o", contract: status === null ? null : { contract_status: status, success_fee_amount: amount } }) as any;

test("取得失敗(null)はカードを残して『取得できませんでした』、0件と区別する", () => {
  assert.equal(cardValueText(null), FETCH_FAILED_TEXT);
  assert.equal(cardValueText(0), "0件");
  assert.equal(cardValueText(3), "3件");
  assert.notEqual(cardValueText(null), cardValueText(0));
});

test("成功報酬が取得できないとき、件数・金額カードは全て null（0にしない）で、カード自体は残る", () => {
  const counts = buildCountCards(null);
  assert.equal(counts.length, 7);
  assert.ok(counts.every((c) => c.value === null));
  const amounts = buildAmountCards(null);
  assert.equal(amounts.length, 3);
  assert.ok(amounts.every((c) => c.value === null));
});

test("成功報酬が取得できて0件なら 0（失敗とは別）", () => {
  assert.ok(buildCountCards([]).every((c) => c.value === 0));
  assert.ok(buildAmountCards([]).every((c) => c.value === "0円" || typeof c.value === "string"));
});

test("毎日の確認: 取得元ごとに独立。契約だけ失敗しても、他のカードは数字を出す", () => {
  const fees = [fee({ fee_status: "confirmed" }), fee({ fee_status: "invoiced", due_date: "2000-01-01", invoice_number: "A" })];
  const cards = buildDailyCards({ fees, issues: [], contracts: null, documents: [] }, "2026-11-19");
  const by = Object.fromEntries(cards.map((c) => [c.label, c.value]));
  assert.equal(by["請求待ち（金額確定済み）"], 1);
  assert.equal(by["支払期限超過"], 1);
  assert.equal(by["整合性の異常"], 0);
  assert.equal(by["契約が停止中の会社"], null);
  assert.equal(by["請求書PDFが未発行"], 1);
});

test("毎日の確認: 請求書PDFの判定は、請求と発行済み書類の両方が必要（どちらか失敗なら null）", () => {
  const fees = [fee({ fee_status: "invoiced", invoice_number: "A" })];
  const a = buildDailyCards({ fees, issues: [], contracts: [], documents: null });
  assert.equal(a.find((c) => c.label === "請求書PDFが未発行")?.value, null);
  const b = buildDailyCards({ fees: null, issues: null, contracts: null, documents: [] });
  assert.ok(b.every((c) => c.value === null));
  assert.equal(b.length, 7);
});

test("毎日の確認: 累計（採用成立）は含めない／導線（href）は全カードに残る", () => {
  const cards = buildDailyCards({ fees: [], issues: [], contracts: [], documents: [] });
  assert.ok(!cards.some((c) => c.label.includes("累計")));
  assert.ok(cards.every((c) => typeof c.href === "string" && c.href.startsWith("/admin/")));
  assert.ok(cards.every((c) => c.value === 0));
});

test("契約カード: 契約が取得できなければ契約系は null、『基準額と請求額が異なる』は成功報酬の取得だけに依存", () => {
  const a = buildContractCards(null, [fee({ fee_amount: 10, contract_success_fee_amount: 20 })]);
  assert.equal(a.length, 6);
  assert.equal(a.find((c) => c.label === "基準額と請求額が異なる成功報酬")?.value, 1);
  assert.ok(a.filter((c) => c.label !== "基準額と請求額が異なる成功報酬").every((c) => c.value === null));
  const b = buildContractCards([contract(null), contract("trial"), contract("suspended", null)], null);
  const by = Object.fromEntries(b.map((c) => [c.label, c.value]));
  assert.equal(by["契約条件が未設定の会社"], 1);
  assert.equal(by["試用中の会社"], 1);
  assert.equal(by["一時停止の会社"], 1);
  assert.equal(by["成功報酬額が未設定の契約"], 1);
  assert.equal(by["基準額と請求額が異なる成功報酬"], null);
});
