import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { extraAckValid, fromPayload, fromPublished, previewConfirm, toPayload, type DraftState } from "@/lib/salon-culture/draft";
import { CultureReview } from "@/components/salon-culture/culture-review";
import { ExtraStep } from "@/components/salon-culture/extra-step";
import { ANALYSIS_VERSION, type BaseAnswers, type SupplementAnswers } from "@/lib/salon-culture/analysis/v1";

// ★診断内容を更新する（案A）: 基本12問＋追加5問を同じフローで見直す。確認操作は「回答の値」と照合して決める。

const ANS = { q1_education_support: 3, q2_challenge_openness: 4, q3_personal_brand_support: 2, q4_team_collaboration: 3, q5_individual_autonomy: 3, q6_work_flexibility: 3, q7_technical_specialization: 3, q8_premium_value: 3, q9_trend_orientation: 5, q10_creative_output: 3, q11_relationship_distance: 3, q12_hierarchy_flatness: 3 };
const BASE: BaseAnswers = { q2_challenge_openness: 4, q3_personal_brand_support: 2, q4_team_collaboration: 3, q5_individual_autonomy: 3, q9_trend_orientation: 5 };
const EXTRA: SupplementAnswers = { q13_nurture_learning_flow: 3, q14_nurture_feedback: 3, q15_brand_staff_presentation: "na", q16_team_handover: 3, q17_discretion_proposal: 3 };

function start(): DraftState {
  return fromPublished({ answers: ANS, value_priorities: ["a", "b", "c"], comment: "" }, { answers: EXTRA });
}
const preview = (draft: DraftState, extraBase: unknown = BASE) =>
  previewConfirm({ hasPublished: true, draft, publishedAnswers: ANS, publishedExtra: EXTRA, publishedExtraBase: extraBase });
const withAnswer = (d: DraftState, k: string, v: number): DraftState => ({ ...d, answers: { ...d.answers, [k]: v }, extraAck: null });

test("関連5問を変えて追加回答を直さない → 確認が必要（追加回答は消えない）", () => {
  const d = withAnswer(start(), "q2_challenge_openness", 1);
  assert.ok(d.extra, "追加回答は保持されている");
  const p = preview(d);
  assert.equal(p.extraAckRequired, true);
  assert.equal(p.extraAckNeeded, true);
  assert.equal(p.changed, true);
});

test("関連5問以外（q1）だけの変更では確認は要らない", () => {
  assert.equal(preview(withAnswer(start(), "q1_education_support", 5)).extraAckRequired, false);
});

test("追加回答を直した（見直した）なら確認は要らない", () => {
  const d = { ...withAnswer(start(), "q2_challenge_openness", 1), extra: { ...EXTRA, q13_nurture_learning_flow: 5 as const } };
  assert.equal(preview(d).extraAckRequired, false);
});

test("確認した後は通る。確認後に関連回答を再変更すると確認をやり直す（元の値へ戻しても同じ）", () => {
  const changed = withAnswer(start(), "q2_challenge_openness", 1);
  const acked: DraftState = { ...changed, extraAck: { base: { ...BASE, q2_challenge_openness: 1 }, extra: EXTRA } };
  assert.equal(extraAckValid(acked), true);
  assert.equal(preview(acked).extraAckRequired, false);
  assert.equal(preview(acked).extraAckNeeded, true, "確認済みでも、確認が要る状況の表示は残す");
  // 再変更: 値が確認時と違う → 無効
  const again = { ...acked, answers: { ...acked.answers, q4_team_collaboration: 5 } };
  assert.equal(extraAckValid(again), false);
  assert.equal(preview(again).extraAckRequired, true);
  // 追加回答を変えた場合も、確認記録は無効（その場合は「直した」ので確認は要らない）
  const extraChanged = { ...acked, extra: { ...EXTRA, q14_nurture_feedback: 1 as const } };
  assert.equal(extraAckValid(extraChanged), false);
});

test("下書きに保存するのは、いまの値と一致する確認記録だけ。読み戻さない（再開・別タブで流用しない）", () => {
  const changed = withAnswer(start(), "q2_challenge_openness", 1);
  const acked: DraftState = { ...changed, extraAck: { base: { ...BASE, q2_challenge_openness: 1 }, extra: EXTRA } };
  const payload = toPayload(acked, ANALYSIS_VERSION);
  assert.ok(payload.extra?.acknowledged, "一致する確認記録は保存される");
  // 値が変わった状態では、古い確認記録を書かない
  const stale = toPayload({ ...acked, answers: { ...acked.answers, q9_trend_orientation: 1 } }, ANALYSIS_VERSION);
  assert.equal(stale.extra?.acknowledged, undefined);
  // 読み戻し: 確認記録は常に捨てる（画面では必ず確認し直す）
  const resumed = fromPayload(payload);
  assert.ok(resumed);
  assert.equal(resumed.extraAck ?? null, null);
  assert.equal(preview(resumed!).extraAckRequired, true);
});

test("古い状態（公開中の回答は変わっていないが、追加回答の基準の基本5問とずれている）でも確認が必要", () => {
  const d = start(); // 回答は何も変えない
  assert.equal(preview(d, BASE).extraAckRequired, false, "基準が一致していれば不要");
  assert.equal(preview(d, { ...BASE, q3_personal_brand_support: 5 }).extraAckRequired, true, "基準とずれていれば必要");
  assert.equal(preview(d, null).extraAckRequired, true, "基準が読めないときも、黙って組み合わせない");
});

test("追加5問が任意である仕様は変えない: 追加回答が無い人は確認も追加回答も求められない", () => {
  const d = fromPublished({ answers: ANS, value_priorities: ["a", "b", "c"], comment: "" }, null);
  const changed = withAnswer(d, "q2_challenge_openness", 1);
  const p = previewConfirm({ hasPublished: true, draft: changed, publishedAnswers: ANS, publishedExtra: null });
  assert.equal(p.extraAckRequired, false);
  assert.equal(p.extraRequired, false);
  assert.equal(p.changed, true);
  // 12問が同じで追加5問を初めて答えるだけなら、変更として数えない（従来どおり）
  const first = previewConfirm({ hasPublished: true, draft: { ...d, extra: EXTRA }, publishedAnswers: ANS, publishedExtra: null });
  assert.equal(first.extraFirst, true);
  assert.equal(first.changed, false);
});

const reviewProps = (o: Partial<React.ComponentProps<typeof CultureReview>> = {}): React.ComponentProps<typeof CultureReview> => ({
  questions: [{ key: "q1_education_support", title: "Q1", leftLabel: "L", rightLabel: "R" }], answers: { q1_education_support: 3 }, valuePriorities: ["a"], comment: "",
  notice: { lines: [], blocking: false }, extraRequired: false, analysisHref: "/x", extra: EXTRA, extraAckNeeded: true, extraAckOk: false, onAcknowledge: () => {}, extraStep: 14,
  error: null, errorCode: null, saving: false, blocked: true, onEdit: () => {}, onConfirm: () => {}, onBack: () => {}, onReload: () => {}, ...o,
});

test("確認画面: 追加回答を消さず一覧表示し、確認操作を出す。確定ボタンは blocked の間は押せない", () => {
  const html = renderToStaticMarkup(React.createElement(CultureReview, reviewProps()));
  assert.match(html, /data-testid="extra-ack-required"/);
  assert.match(html, /追加の回答は消さずに下に表示しています/);
  assert.match(html, /この内容で確認しました/);
  assert.match(html, /data-testid="review-extra"/);
  assert.match(html, /当てはまらない/); // na もそのまま表示
  assert.match(html, /この内容で確定する<\/button>/);
  assert.match(html, /disabled=""[^>]*>この内容で確定する|<button[^>]*disabled=""[^>]*>[^<]*この内容で確定する/);
});

test("確認画面: 確認済みなら確認ボタンは押下済み表示。追加回答が無い人には未回答（任意）と表示", () => {
  const ok = renderToStaticMarkup(React.createElement(CultureReview, reviewProps({ extraAckOk: true, blocked: false })));
  assert.match(ok, /✓ この内容で確認しました/);
  const none = renderToStaticMarkup(React.createElement(CultureReview, reviewProps({ extra: {}, extraAckNeeded: false })));
  assert.match(none, /未回答（答えなくても他の機能は使えます）/);
  assert.ok(!none.includes("extra-ack-required"));
});

test("追加の5問ステップ: 任意と明記し、既存回答を選択済みで表示する", () => {
  const html = renderToStaticMarkup(React.createElement(ExtraStep, { values: EXTRA, onChange: () => {}, hasPublishedExtra: true, partial: false }));
  assert.match(html, /追加の5問（任意）/);
  assert.match(html, /これまでの回答を選択済みで表示しています/);
  assert.match(html, /aria-pressed="true"/); // na が選択済み
  const first = renderToStaticMarkup(React.createElement(ExtraStep, { values: {}, onChange: () => {}, hasPublishedExtra: false, partial: true }));
  assert.match(first, /答えなくても、他の機能は今までどおり使えます/);
  assert.match(first, /すべて空のままにしてください/);
});

// ---- 追加5問の途中回答（1〜4問）の保持 ----
import { cleanPartial, countPartial } from "@/lib/salon-culture/draft";

test("途中回答: 1問・4問だけの回答が payload に載り、読み戻しで同じ選択が戻る（補完しない）", () => {
  for (const partial of [{ q13_nurture_learning_flow: 4 }, { q13_nurture_learning_flow: 2, q14_nurture_feedback: "na", q15_brand_staff_presentation: 5, q16_team_handover: 1 }] as const) {
    const s: DraftState = { ...fromPublished(null, null), answers: ANS, extra: null, extraPartial: partial };
    const payload = toPayload(s, "v1");
    assert.equal(payload.extra, null, "完成していない回答は公開用の extra に入れない");
    assert.deepEqual(payload.extra_partial?.answers, partial);
    const back = fromPayload(JSON.parse(JSON.stringify(payload)));
    assert.deepEqual(back?.extraPartial, partial);
    assert.equal(back?.extra, null);
    assert.equal(countPartial(back?.extraPartial), Object.keys(partial).length);
  }
});

test("途中回答: 空・完成済みのときは extra_partial を書かない／無効な値は捨てる", () => {
  const base: DraftState = { ...fromPublished(null, null), answers: ANS, extra: null };
  assert.equal("extra_partial" in toPayload({ ...base, extraPartial: {} }, "v1"), false);
  assert.equal("extra_partial" in toPayload({ ...base, extraPartial: null }, "v1"), false);
  assert.equal("extra_partial" in toPayload({ ...base, extra: EXTRA, extraPartial: { q13_nurture_learning_flow: 1 } }, "v1"), false);
  assert.deepEqual(cleanPartial({ q13_nurture_learning_flow: 9, q14_nurture_feedback: 0, q15_brand_staff_presentation: "x", q16_team_handover: 3, zzz: 1 }), { q16_team_handover: 3 });
  // 完成した extra がある下書きを読むと、途中回答は無視される
  const both = fromPayload({ ...toPayload({ ...base, extra: EXTRA }, "v1"), extra_partial: { version: "v1", answers: { q13_nurture_learning_flow: 1 } } });
  assert.equal(both?.extraPartial, null);
});

test("途中回答: 確認記録(ack)は途中回答では成立しない／互換: 旧形式の下書きは途中回答なしとして読める", () => {
  const s: DraftState = { ...fromPublished(null, null), answers: ANS, extra: null, extraPartial: { q13_nurture_learning_flow: 3 }, extraAck: { base: BASE, extra: EXTRA } };
  assert.equal(extraAckValid(s), false);
  const legacy = fromPayload({ respondent_role: "x", current_step: 0, answers: ANS, value_priorities: [], comment: "", extra: null });
  assert.equal(legacy?.extraPartial, null);
});
