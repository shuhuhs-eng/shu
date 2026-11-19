import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCOUT_RESPONSE_OPTIONS, SCOUT_RESPONSE_LABELS, isPositiveScoutResponse, isVisitOrTrialRequest } from "../lib/scouts/options";
import { countPendingPositiveScouts } from "../lib/hiring/pending";

test("返信の選択肢: 見学・体験入店は別の値で、辞退などの既存の選択肢は維持。「話を聞いてみたい」は新規に選べない", () => {
  const v = SCOUT_RESPONSE_OPTIONS.map((o) => o.value);
  assert.deepEqual([...v], ["visit_requested", "trial_requested", "question", "considering", "declined"]);
  assert.ok(!v.includes("interested" as never));
  assert.notEqual(SCOUT_RESPONSE_LABELS.visit_requested, SCOUT_RESPONSE_LABELS.trial_requested);
  assert.equal(SCOUT_RESPONSE_LABELS.visit_requested, "見学を希望する");
  assert.equal(SCOUT_RESPONSE_LABELS.trial_requested, "体験入店を希望する");
});

test("過去の「話を聞いてみたい」は読み替えない（見学・体験入店の希望として扱わず、過去の返信として表示）", () => {
  assert.ok(!isVisitOrTrialRequest("interested"));
  assert.match(SCOUT_RESPONSE_LABELS.interested, /以前の返信/);
  assert.ok(isPositiveScoutResponse("interested"), "採用進捗への追加対象は従来どおり");
});

test("前向きな返信の集合（DBの add_hiring_candidate と同じ）: 見学・体験入店を含み、辞退・検討中・未回答は含まない", () => {
  for (const s of ["visit_requested", "trial_requested", "interested", "question"]) assert.ok(isPositiveScoutResponse(s), s);
  for (const s of ["considering", "declined", "no_response", "expired"]) assert.ok(!isPositiveScoutResponse(s), s);
  assert.equal(
    countPendingPositiveScouts([{ stylist_user_id: "a", response_status: "visit_requested" }, { stylist_user_id: "b", response_status: "trial_requested" }, { stylist_user_id: "c", response_status: "declined" }], []),
    2,
  );
});

test("静的検査: 送信の検証は新2値を許可し interested を新規には許可しない。DB関数名・スカウト消費の経路は変えない", () => {
  const a = readFileSync("lib/scouts/actions.ts", "utf8");
  assert.match(a, /z\.enum\(\["visit_requested", "trial_requested", "question", "considering", "declined"\]\)/);
  assert.match(a, /rpc\("respond_scout"/);
  assert.ok(!/send_scout/.test(a.slice(a.indexOf("respondScoutSchema"))), "返信でスカウトを送信・消費しない");
});

test("静的検査: 確認文言に「日程や参加はまだ確定しません」。店舗側にも未確定の注記", () => {
  const card = readFileSync("components/scouts/stylist-scout-card.tsx", "utf8");
  assert.match(card, /日程や参加はまだ確定しません/);
  assert.match(card, /見学を希望する/);
  assert.match(card, /体験入店を希望する/);
  const page = readFileSync("app/salon/stores/[storeId]/scouts/page.tsx", "utf8");
  assert.match(page, /日程や参加はまだ確定していません/);
});
