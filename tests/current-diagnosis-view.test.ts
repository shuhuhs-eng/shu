import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { decideDiagnosisView, decideStudentResultStatus, mypageSections, readCurrentDiagnosis, type CurrentDiagnosisRead } from "../lib/student-diagnosis/current";
import { StudentCurrentCard } from "../components/student-diagnosis/student-current-card";
import { computeStudentResult } from "../lib/student-diagnosis/result";
import { STUDENT_QUESTIONS, STUDENT_DIAGNOSIS_VERSION, type StudentAnswers } from "../lib/student-diagnosis/questions";

const ok = (bank: "experienced" | "student" | null, id = "r1"): CurrentDiagnosisRead => ({ status: "ok", current: bank ? { bank, resultId: id, seq: 1 } : null });

test("マイページ: 現在が学生・新卒なら学生用だけ。経験者向け（才能グラフ・経験分析・AI解説）は出さない", () => {
  assert.equal(decideDiagnosisView(ok("student")), "student");
  assert.deepEqual(mypageSections("student"), { showExperienced: false, showStudent: true, showUnknownNotice: false });
});
test("マイページ: 現在が経験者・診断なし・0071未適用は従来の表示（経験者向け）のまま", () => {
  for (const r of [ok("experienced"), ok(null), { status: "unsupported" } as CurrentDiagnosisRead]) {
    assert.equal(decideDiagnosisView(r), "experienced");
    assert.deepEqual(mypageSections("experienced"), { showExperienced: true, showStudent: false, showUnknownNotice: false });
  }
});
test("マイページ: 現在の診断を読めないときは、どちらの結果も現在として出さず案内だけ", () => {
  assert.equal(decideDiagnosisView({ status: "error" }), "unknown");
  assert.deepEqual(mypageSections("unknown"), { showExperienced: false, showStudent: false, showUnknownNotice: true });
});
test("学生結果ページ: 現在の結果／過去の結果／確認不能を取り違えない", () => {
  assert.equal(decideStudentResultStatus(ok("student", "s2"), "s2"), "current");
  assert.equal(decideStudentResultStatus(ok("student", "s2"), "s1"), "past", "学生が現在でも、別の（古い）学生結果は過去");
  assert.equal(decideStudentResultStatus(ok("experienced", "e1"), "s1"), "past", "現在が経験者なら学生結果は過去");
  assert.equal(decideStudentResultStatus(ok(null), "s1"), "past");
  assert.equal(decideStudentResultStatus({ status: "error" }, "s1"), "unknown");
});
test("現在の診断の読み取り: 表なし=unsupported／その他の失敗=error／行なし=null／不正な値=error", async () => {
  const mk = (res: unknown) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => res }) }) }) }) as never;
  assert.deepEqual(await readCurrentDiagnosis(mk({ data: null, error: { code: "42P01", message: 'relation "stylist_diagnosis_current" does not exist' } }), "u"), { status: "unsupported" });
  assert.deepEqual(await readCurrentDiagnosis(mk({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.stylist_diagnosis_current'" } }), "u"), { status: "unsupported" });
  assert.deepEqual(await readCurrentDiagnosis(mk({ data: null, error: { code: "PGRST301", message: "JWT expired" } }), "u"), { status: "error" });
  assert.deepEqual(await readCurrentDiagnosis(mk({ data: null, error: null }), "u"), { status: "ok", current: null });
  assert.deepEqual(await readCurrentDiagnosis(mk({ data: { bank: "student", result_id: "s1", seq: 3 }, error: null }), "u"), { status: "ok", current: { bank: "student", resultId: "s1", seq: 3 } });
  assert.deepEqual(await readCurrentDiagnosis(mk({ data: { bank: "other", result_id: "s1", seq: 3 }, error: null }), "u"), { status: "error" });
});

const answers: StudentAnswers = {};
for (const q of STUDENT_QUESTIONS) {
  if (q.kind === "single") answers[q.id] = ["a"]; else if (q.kind === "multi" && q.min >= 1) answers[q.id] = ["a"]; else if (q.kind === "ranked") answers[q.id] = [q.options[0].id];
}
test("学生の現在結果カード: 学生用の内容だけ。経験者の才能・市場価値・AIの語を出さず、過去の経験者診断が残る旨を明示", () => {
  const r = computeStudentResult(answers, STUDENT_DIAGNOSIS_VERSION);
  const withPast = renderToStaticMarkup(createElement(StudentCurrentCard, { result: r, hasPastExperienced: true })).replace(/<[^>]+>/g, " ");
  assert.ok(withPast.includes("いまの診断（美容学生・新卒向け）") && withPast.includes("現在の結果ではないため、ここには表示していません"));
  assert.ok(!/才能|市場価値|年収|AI|6つ/.test(withPast.replace("現役の美容師向けの診断", "")));
  const noPast = renderToStaticMarkup(createElement(StudentCurrentCard, { result: r, hasPastExperienced: false })).replace(/<[^>]+>/g, " ");
  assert.ok(!noPast.includes("以前に受けた"));
});
test("画面の構造: 「いまの立場」は経験者向けの表示（条件分岐）の外、学生結果ページは過去の結果を明示、0071未適用では従来のまま", () => {
  const my = readFileSync("app/stylist/mypage/page.tsx", "utf8");
  const iPhase = my.indexOf("<CareerPhaseSummary"), iExp = my.indexOf("sections.showExperienced &&");
  assert.ok(iPhase > 0 && iExp > iPhase, "いまの立場は経験者向けの分岐より前（分岐の外）");
  assert.ok(my.indexOf("<DiagnosisSummary") > iExp && my.indexOf("<CoreTypeHeader") > iExp, "経験者向けの部品は経験者のときだけの分岐の中");
  assert.ok(my.includes('{ status: "unsupported" } as const'), "0071未適用は従来表示");
  const res = readFileSync("app/stylist/diagnosis/student/result/page.tsx", "utf8");
  assert.ok(res.includes("現在の結果ではありません") && res.includes('status === "past"') && res.includes("decideStudentResultStatus("));
});
