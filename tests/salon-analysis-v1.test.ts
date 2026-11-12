import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_AXES,
  ANALYSIS_VERSION,
  BASE_KEYS,
  SUPPLEMENT_KEYS,
  changedBaseKeys,
  extractBaseAnswers,
  extractSupplementAnswers,
  pairToStep,
  resolveCultureAnalysis,
  scenesDiffer,
  type SupplementAnswers,
} from "../lib/salon-culture/analysis/v1";
import { SCENES, sceneSentence } from "../lib/salon-culture/analysis/scenes";
import { SCHEMA_KEYS, supplementAnswersSchema, expectedBaseSchema } from "../lib/validation/salon-culture-analysis";

const BASE = {
  q2_challenge_openness: 3,
  q3_personal_brand_support: 3,
  q4_team_collaboration: 3,
  q5_individual_autonomy: 3,
  q9_trend_orientation: 3,
};
const SUP: SupplementAnswers = {
  q13_nurture_learning_flow: 3,
  q14_nurture_feedback: 3,
  q15_brand_staff_presentation: 3,
  q16_team_handover: 3,
  q17_discretion_proposal: 3,
};
const run = (base: Record<string, unknown>, sup: Partial<SupplementAnswers> | null, snapshot: Record<string, unknown> = base) =>
  resolveCultureAnalysis({
    baseStatus: "completed",
    baseAnswers: base,
    supplement: sup ? { answers: { ...SUP, ...sup }, base_snapshot: snapshot } : null,
  });

test("バージョンとキー定義: v1・既存5＋追加5・zodと一致", () => {
  assert.equal(ANALYSIS_VERSION, "salon-analysis-v1");
  assert.deepEqual(Object.keys(supplementAnswersSchema.shape).sort(), [...SUPPLEMENT_KEYS].sort());
  assert.deepEqual(Object.keys(expectedBaseSchema.shape).sort(), [...BASE_KEYS].sort());
  assert.deepEqual(SCHEMA_KEYS.supplement, [...SUPPLEMENT_KEYS]);
  assert.equal(ANALYSIS_AXES.length, 5);
  // 各軸は「別の2場面」で、同じ質問を2回使わず、5軸で10場面すべて別
  const all = ANALYSIS_AXES.flatMap((a) => a.scenes.map((s) => s.key));
  assert.equal(new Set(all).size, 10);
});

test("案B: 25通りすべて、平均の固定境界（1.8/2.6/3.4/4.2）と一致する", () => {
  const ref = (a: number, b: number) => {
    const m = (a + b) / 2;
    return m < 1.8 ? 1 : m < 2.6 ? 2 : m < 3.4 ? 3 : m < 4.2 ? 4 : 5;
  };
  let n = 0;
  for (let a = 1; a <= 5; a++) {
    for (let b = 1; b <= 5; b++) {
      assert.equal(pairToStep(a as 1, b as 1), ref(a, b), `(${a},${b})`);
      assert.equal(pairToStep(a as 1, b as 1), pairToStep(b as 1, a as 1), `対称 (${a},${b})`);
      n++;
    }
  }
  assert.equal(n, 25);
});

test("案B: 代表例 (3,5)(4,5)(1,5)(2,4) と、段階5が『両方5』を意味しないこと", () => {
  assert.equal(pairToStep(3, 5), 4);
  assert.equal(pairToStep(4, 5), 5);
  assert.equal(pairToStep(1, 5), 3);
  assert.equal(pairToStep(2, 4), 3);
  const fives = [];
  for (let a = 1; a <= 5; a++) for (let b = 1; b <= 5; b++) if (pairToStep(a as 1, b as 1) === 5) fives.push([a, b]);
  assert.deepEqual(fives, [[4, 5], [5, 4], [5, 5]]);
});

test("場面差: 差が2以上の12通りだけ differ。(1,5)(2,4) も対象で、矛盾とは書かない", () => {
  let diff = 0;
  for (let a = 1; a <= 5; a++) for (let b = 1; b <= 5; b++) if (scenesDiffer(a as 1, b as 1)) diff++;
  assert.equal(diff, 12);
  const r = run({ ...BASE, q3_personal_brand_support: 1 }, { q15_brand_staff_presentation: 5 });
  const ax = r.axes.find((a) => a.id === "personal_brand")!;
  assert.equal(ax.step, 3);
  assert.equal(ax.differ, true);
  const text = JSON.stringify(r);
  assert.ok(!/矛盾|悪い|一貫性がない/.test(text));
});

test("25通り×説明文・根拠文: 段階の説明と根拠文が食い違わない（軸③で全組み合わせ）", () => {
  const def = ANALYSIS_AXES.find((a) => a.id === "personal_brand")!;
  for (let a = 1; a <= 5; a++) {
    for (let b = 1; b <= 5; b++) {
      const r = run({ ...BASE, q3_personal_brand_support: a }, { q15_brand_staff_presentation: b as 1 });
      const ax = r.axes.find((x) => x.id === "personal_brand")!;
      assert.equal(ax.status, "determined");
      assert.equal(ax.step, pairToStep(a as 1, b as 1));
      assert.equal(ax.differ, Math.abs(a - b) >= 2);
      // 説明文
      if (ax.step === 3) assert.match(ax.description!, /中間/);
      else if (ax.step! <= 2) assert.ok(ax.description!.includes(def.low) && !ax.description!.includes(def.high), `(${a},${b})`);
      else assert.ok(ax.description!.includes(def.high) && !ax.description!.includes(def.low), `(${a},${b})`);
      assert.match(ax.description!, /^回答全体では、/);
      // 場面ごとの根拠文は各回答だけに基づく（1/5=はっきり、2/4=どちらかといえば、3=中間）
      const [s1, s2] = ax.scenes;
      assert.equal(s1.sentence, sceneSentence("personal_brand_support", a as 1));
      assert.equal(s2.sentence, sceneSentence("q15_brand_staff_presentation", b as 1));
      for (const [ans, s] of [[a, s1], [b, s2]] as const) {
        if (ans === 3) assert.match(s.sentence!, /中間/);
        if (ans === 1 || ans === 5) assert.match(s.sentence!, /はっきり/);
        if (ans === 2 || ans === 4) assert.match(s.sentence!, /どちらかといえば/);
      }
    }
  }
});

test("5軸すべて: 追加回答の組み合わせでも段階が決まり、五角形を描ける", () => {
  const r = run(BASE, {});
  assert.equal(r.state, "ready");
  assert.equal(r.drawable, true);
  assert.deepEqual(r.axes.map((a) => a.step), [3, 3, 3, 3, 3]);
  const r2 = run(
    { q2_challenge_openness: 5, q3_personal_brand_support: 2, q4_team_collaboration: 1, q5_individual_autonomy: 5, q9_trend_orientation: 5 },
    { q13_nurture_learning_flow: 4, q14_nurture_feedback: 4, q15_brand_staff_presentation: 2, q16_team_handover: 1, q17_discretion_proposal: 5 },
  );
  assert.deepEqual(r2.axes.map((a) => a.step), [4, 5, 2, 1, 5]);
});

test("軸の独立: ④連携と⑤裁量は互いの値で変わらない（対立概念として扱わない）", () => {
  const a = run({ ...BASE, q4_team_collaboration: 5 }, { q16_team_handover: 5 });
  const b = run({ ...BASE, q4_team_collaboration: 1 }, { q16_team_handover: 1 });
  assert.equal(a.axes[4].step, 3);
  assert.equal(b.axes[4].step, 3);
  assert.equal(a.axes[3].step, 5);
  assert.equal(b.axes[3].step, 1);
  // サロン全体の発信（q10）は5軸の入力に存在しない
  assert.ok(!JSON.stringify(ANALYSIS_AXES).includes("creative_output"));
});

test("「当てはまらない」: 数値で埋めず、その軸は判定不可。図は描かず、読める根拠文は残す", () => {
  const r = run(BASE, { q15_brand_staff_presentation: "na", q13_nurture_learning_flow: 5 });
  assert.equal(r.state, "partial");
  assert.equal(r.drawable, false);
  const pb = r.axes.find((a) => a.id === "personal_brand")!;
  assert.equal(pb.status, "undetermined_na");
  assert.equal(pb.step, null);
  assert.ok(pb.scenes[0].sentence, "回答済みの場面の根拠文は読める");
  assert.match(pb.scenes[1].sentence!, /当てはまらない/);
  const other = r.axes.filter((a) => a.id !== "personal_brand");
  assert.ok(other.every((a) => a.status === "determined"), "他の軸は判定できる");
});

test("追加回答が無い: 既存回答だけで判定できる軸（②）は読め、図は描かない", () => {
  const r = run({ ...BASE, q2_challenge_openness: 5, q9_trend_orientation: 4 }, null);
  assert.equal(r.state, "need_supplement");
  assert.equal(r.drawable, false);
  const novelty = r.axes.find((a) => a.id === "novelty")!;
  assert.equal(novelty.step, 5);
  assert.equal(r.axes.find((a) => a.id === "nurture")!.status, "pending");
  const pb = r.axes.find((a) => a.id === "personal_brand")!;
  assert.equal(pb.status, "pending");
  assert.ok(pb.scenes[0].sentence, "既存回答の根拠文は読める");
  assert.equal(pb.scenes[1].sentence, null);
});

test("既存回答が追加回答のあとに変わった: 黙って組み合わせず stale にする", () => {
  const snapshot = { ...BASE, q3_personal_brand_support: 2 };
  const r = run(BASE, { q15_brand_staff_presentation: 5 }, snapshot);
  assert.equal(r.state, "stale");
  assert.equal(r.drawable, false);
  const pb = r.axes.find((a) => a.id === "personal_brand")!;
  assert.equal(pb.status, "stale");
  assert.equal(pb.step, null);
  assert.equal(pb.scenes[1].sentence, null, "古い画面前提の追加回答の文は出さない");
  // 影響を受けない軸は読める
  assert.equal(r.axes.find((a) => a.id === "novelty")!.status, "determined");
  assert.equal(r.axes.find((a) => a.id === "nurture")!.status, "determined");
  assert.deepEqual(changedBaseKeys(snapshot, BASE as never), ["q3_personal_brand_support"]);
  // 変わった回答を、元に戻せば（現在値=snapshot）ふたたび ready
  assert.equal(run(snapshot, { q15_brand_staff_presentation: 5 }, snapshot).state, "ready");
});

test("状態: 未回答/途中/旧データ（既存5つが揃わない）/不正な追加回答", () => {
  assert.equal(resolveCultureAnalysis({ baseStatus: null, baseAnswers: null, supplement: null }).state, "base_none");
  assert.equal(resolveCultureAnalysis({ baseStatus: "draft", baseAnswers: {}, supplement: null }).state, "base_draft");
  for (const legacy of [null, {}, { q2_challenge_openness: 3 }, { ...BASE, q9_trend_orientation: 6 }, { ...BASE, q5_individual_autonomy: "3" }, []]) {
    const r = resolveCultureAnalysis({ baseStatus: "completed", baseAnswers: legacy, supplement: null });
    assert.equal(r.state, "base_unusable");
    assert.equal(r.axes.length, 0);
  }
  // 追加回答の形が不正なら、推測せず未回答扱い
  for (const bad of [null, {}, { ...SUP, q13_nurture_learning_flow: 0 }, { ...SUP, q14_nurture_feedback: "3" }, { ...SUP, q15_brand_staff_presentation: null }]) {
    const r = resolveCultureAnalysis({ baseStatus: "completed", baseAnswers: BASE, supplement: { answers: bad, base_snapshot: BASE } });
    assert.equal(r.state, "need_supplement");
  }
  assert.equal(extractSupplementAnswers([]), null);
  assert.equal(extractBaseAnswers(BASE)?.q2_challenge_openness, 3);
});

test("再現性と独立性: 同じ入力は同じ結果。他の軸の回答は軸の段階に影響しない", () => {
  const input = { ...BASE, q2_challenge_openness: 4 };
  assert.deepEqual(run(input, { q13_nurture_learning_flow: 2 }), run(input, { q13_nurture_learning_flow: 2 }));
  const x = run(BASE, { q17_discretion_proposal: 1 });
  const y = run(BASE, { q17_discretion_proposal: 5 });
  assert.deepEqual(x.axes.slice(0, 4), y.axes.slice(0, 4), "⑤を変えても①〜④は同じ");
});

test("質問文: 質問16の左端は『不在の担当者が対応する』にならず、右端は希望・技術確認を含む", () => {
  const s = SCENES.q16_team_handover;
  assert.equal(s.low, "担当者を基本とし、不在時は予約変更などを個別に調整する");
  assert.match(s.high, /お客様のご希望や対応できる技術を確認したうえで/);
  assert.match(s.high, /他のスタッフが引き継いで対応する/);
  assert.ok(!/不在の担当者/.test(s.low));
});

test("画面文言に優劣・能力・統計的な断定を使わない", () => {
  const all = JSON.stringify([ANALYSIS_AXES, SCENES]);
  for (const w of ["点数", "才能", "総合ランク", "星", "業界平均", "高評価", "低評価", "優れ", "劣"]) {
    assert.ok(!all.includes(w), w);
  }
});
