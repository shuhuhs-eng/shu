import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STUDENT_QUESTIONS, STUDENT_DIAGNOSIS_VERSION, isValidStudentAnswers, type StudentAnswers, type StudentQuestion,
} from "../lib/student-diagnosis/questions";
import { computeStudentResult, describeStudentResult, studentNextSteps } from "../lib/student-diagnosis/result";

const single = (q: StudentQuestion & { kind: "single" }, i: number) => q.options[i].id;
/** 全問に最初の選択肢で答えた回答（有効）。 */
function base(): StudentAnswers {
  const a: StudentAnswers = {};
  for (const q of STUDENT_QUESTIONS) {
    if (q.kind === "single") a[q.id] = [single(q as never, 0)];
    else if (q.kind === "multi" && q.min > 0) a[q.id] = [q.options[0].id];
    else if (q.kind === "ranked") a[q.id] = [q.options[0].id];
  }
  return a;
}
const BANNED = /即戦力|高い技術|実力|才能|市場価値|年収|ランク|点数|％|%|[0-9０-９]/;

test("質問セット: 15問・実績や経験を前提とする語が無い・『該当なし』の選択肢が無い", () => {
  assert.equal(STUDENT_QUESTIONS.length, 15);
  const text = JSON.stringify(STUDENT_QUESTIONS.map((q) => ({ t: q.text, o: "options" in q ? q.options.map((o) => o.label) : [] })));
  for (const w of ["指名", "売上", "後輩に教え", "客単価", "リピート率", "集客した", "経験年数", "該当なし", "特にない", "あてはまらない"]) assert.ok(!text.includes(w), `使わない語: ${w}`);
});

test("選択機会が揃っている: 興味の6タグ・教育環境の5タグは、それぞれちょうど4回選択肢に出る（出やすさで順位がつかない）", () => {
  for (const section of ["interest", "env"] as const) {
    const counts: Record<string, number> = {};
    const qs = STUDENT_QUESTIONS.filter((q) => q.section === section);
    for (const q of qs) {
      const tags = (q as { options: { tag: string }[] }).options.map((o) => o.tag);
      assert.equal(new Set(tags).size, tags.length, "1問に同じタグが2回出ない");
      assert.equal(tags.length, 4);
      tags.forEach((t) => (counts[t] = (counts[t] ?? 0) + 1));
    }
    const values = Object.values(counts);
    assert.ok(values.every((n) => n === 4), `${section}: ${JSON.stringify(counts)}`);
    assert.equal(Object.keys(counts).length, section === "interest" ? 6 : 5);
  }
});

test("回答の検査: 欠け・重複・存在しない選択肢・Q8がQ7の外・上限超過を拒否する", () => {
  assert.ok(isValidStudentAnswers(base()));
  const a = base();
  assert.ok(!isValidStudentAnswers({ ...a, q1: [] }));
  assert.ok(!isValidStudentAnswers({ ...a, q1: ["a", "b"] }));
  assert.ok(!isValidStudentAnswers({ ...a, q1: ["zzz"] }));
  assert.ok(!isValidStudentAnswers({ ...a, q7: ["a", "b", "c", "d"] }));
  assert.ok(!isValidStudentAnswers({ ...a, q7: ["a", "a"] }));
  assert.ok(!isValidStudentAnswers({ ...a, q8: ["b"] })); // q7=[a] の外
  assert.ok(isValidStudentAnswers({ ...a, q8: ["a"] }));
  assert.ok(!isValidStudentAnswers({ ...a, q9: ["work_life_balance", "skill_growth", "teamwork", "independence"] }));
  assert.ok(!isValidStudentAnswers({ ...a, q9: ["not_a_code"] }));
  assert.ok(!isValidStudentAnswers({ ...a, q15: ["a", "b", "c"] }));
  assert.ok(isValidStudentAnswers({ ...a, q15: [] }));
  assert.ok(!isValidStudentAnswers({ ...a, extra: ["a"] }));
  const { q2, ...missing } = a; void q2;
  assert.ok(!isValidStudentAnswers(missing));
  assert.ok(!isValidStudentAnswers(null) && !isValidStudentAnswers([]) && !isValidStudentAnswers("x"));
});

/** 指定タグを選べる質問では指定タグを、出ていない質問では先頭を選ぶ。 */
function pick(section: "interest" | "env", tags: string[]): StudentAnswers {
  const a = base();
  for (const q of STUDENT_QUESTIONS.filter((x) => x.section === section)) {
    const opts = (q as { options: { id: string; tag: string }[] }).options;
    const hit = opts.find((o) => tags.includes(o.tag));
    a[q.id] = [(hit ?? opts[0]).id];
  }
  return a;
}

test("同数は『同程度』として同列に並べる（固定順で優劣を付けない）。順序に依存しない", () => {
  // 技術2回・接客2回・その他1回ずつ → 技術と接客が同数の最多
  const a = base();
  Object.assign(a, { q1: ["a"], q2: ["a"], q3: ["c"], q4: ["d"], q5: ["a"], q6: ["d"] });
  const r1 = computeStudentResult(a, STUDENT_DIAGNOSIS_VERSION);
  assert.deepEqual(r1.interests.top, ["craft", "service"]);
  assert.equal(r1.interests.balanced, false);
  assert.equal(r1.interests.weak, false);
  // 回答の入力順（キーの並び）を変えても同じ結果＝並び順が結果を左右しない
  const rev: StudentAnswers = Object.fromEntries(Object.entries(a).reverse());
  assert.deepEqual(computeStudentResult(rev, STUDENT_DIAGNOSIS_VERSION).interests, r1.interests);
  // top は辞書順に固定（優先順位ではない）。describe は同じ文で「同じくらい」と表現する
  assert.deepEqual([...r1.interests.top], [...r1.interests.top].sort());
  assert.match(describeStudentResult(r1).interest, /同じくらい/);
});

test("偏りが無い／強い傾向が出ない場合は、個別に並べ立てない", () => {
  // 各タグを均等に近く選ぶ: q1..q6 の先頭は service,craft,craft,design,craft,craft → 偏る。全タグ同数にするには各タグ1回ずつ
  const a = base();
  const want = ["service", "craft", "design", "share", "challenge", "team"];
  // 6問それぞれが出す4タグのうち、まだ選んでいないタグを順に1つ選ぶ（各タグ1回ずつ＝最多1回）
  const used = new Set<string>();
  for (const q of STUDENT_QUESTIONS.filter((x) => x.section === "interest")) {
    const opts = (q as { options: { id: string; tag: string }[] }).options;
    const hit = opts.find((o) => !used.has(o.tag)) ?? opts[0];
    used.add(hit.tag); a[q.id] = [hit.id];
  }
  void want;
  const r = computeStudentResult(a, STUDENT_DIAGNOSIS_VERSION);
  assert.equal(r.interests.weak, true);
  assert.deepEqual(r.interests.top, []);
  assert.match(describeStudentResult(r).interest, /特に強い傾向は出ませんでした/);
});

test("結果の文章に、点数・割合・数字・能力の断定・給与や市場価値の語が出ない", () => {
  const tagSets = [["craft"], ["craft", "service"], ["design", "share"], ["challenge"], ["team", "service", "craft"]];
  for (const tags of tagSets) for (const envTags of [["step"], ["mentor", "early"], ["self"], ["team", "step"]]) {
    const a = { ...pick("interest", tags), ...pick("env", envTags), q7: ["a", "b", "c"], q8: ["b"], q9: ["education_support", "work_life_balance", "teamwork"], q15: ["a", "d"] };
    const r = computeStudentResult(a, STUDENT_DIAGNOSIS_VERSION);
    const d = describeStudentResult(r);
    const all = [d.interest, d.learning, ...d.values, d.env, ...studentNextSteps(r)].join("\n");
    assert.ok(!BANNED.test(all), all);
  }
});

test("次の一手: 教育環境の型と不安から、見学・カリキュラム・練習や相談体制の確認を提案する", () => {
  const a = { ...pick("env", ["step"]), q15: ["a", "d"] };
  const steps = studentNextSteps(computeStudentResult(a, STUDENT_DIAGNOSIS_VERSION)).join("\n");
  assert.match(steps, /カリキュラム/);
  assert.match(steps, /練習/);
  assert.match(steps, /お客様の前に立つまでのステップ/); // 不安: 緊張
  assert.match(steps, /シフト/); // 不安: 休みや勤務時間
});

test("本人が選んだ内容はそのまま表示する（学びたいこと・大切にしたい働き方は集計しない。選んだ順を保つ）", () => {
  const a = { ...base(), q7: ["c", "a"], q8: ["a"], q9: ["teamwork", "education_support"] };
  const r = computeStudentResult(a, STUDENT_DIAGNOSIS_VERSION);
  assert.deepEqual(r.learning.chosen, ["perm", "cut"]);
  assert.equal(r.learning.focus, "cut");
  assert.deepEqual(r.values, ["teamwork", "education_support"]);
  assert.throws(() => computeStudentResult({ ...a, q1: [] } as never, STUDENT_DIAGNOSIS_VERSION));
});
