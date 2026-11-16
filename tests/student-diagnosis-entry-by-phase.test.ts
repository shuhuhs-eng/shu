// 新卒向け診断の「受ける・始める・受け直す」入口は、立場が「新卒」のときだけ。保存済みの結果を見るリンクは残す。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canStartStudentDiagnosis, EMPTY_CAREER_PHASE, type CareerPhaseRead } from "../lib/student-diagnosis/career-phase";
import { RetakeLink } from "../components/mypage/retake-link";
import { CareerPhaseSummary, StudentPastResultLink } from "../components/student-diagnosis/career-phase-summary";

const ok = (v: Partial<typeof EMPTY_CAREER_PHASE>): CareerPhaseRead => ({ status: "ok", value: { ...EMPTY_CAREER_PHASE, ...v } });
const CASES: [string, CareerPhaseRead | null, boolean][] = [
  ["新卒", ok({ phase: "new_graduate", graduationYm: "2027-03" }), true],
  ["現役の美容師", ok({ phase: "experienced" }), false],
  ["ブランクあり", ok({ phase: "blank" }), false],
  ["未選択（未設定）", ok({}), false],
  ["未選択（旧・美容学生）", ok({ legacyStudent: true, graduationYm: "2027-03" }), false],
  ["読み込み失敗", { status: "error" }, false],
  ["0071未適用", { status: "unsupported" }, false],
  ["未取得", null, false],
];
test("入口の可否: 新卒だけ true（現役・ブランクあり・未選択・旧美容学生・失敗・未適用は false）", () => {
  for (const [name, read, want] of CASES) assert.equal(canStartStudentDiagnosis(read), want, name);
});

const LIMIT = { state: "can_change", lockedUntil: null } as never;
const text = (el: unknown) => renderToStaticMarkup(el as never).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const html = (el: unknown) => renderToStaticMarkup(el as never);
test("マイページ最下部: 新卒だけ『診断を受け直す』が出る。それ以外は新卒向けの再診断リンクを出さない（現役向け診断への案内は従来どおり）", () => {
  const sec = { href: "/stylist/diagnosis", label: "現役の美容師向けの診断を受ける" };
  for (const [name, read, want] of CASES) {
    const h = html(createElement(RetakeLink, { limit: LIMIT, href: "/stylist/diagnosis/student", hideBaseText: true, hidePrimary: !canStartStudentDiagnosis(read), secondary: sec }));
    assert.equal(h.includes('href="/stylist/diagnosis/student"'), want, `${name}: 新卒向け再診断リンク`);
    assert.equal(text(createElement(RetakeLink, { limit: LIMIT, href: "/stylist/diagnosis/student", hideBaseText: true, hidePrimary: !want, secondary: sec })).includes("診断を受け直す"), want, `${name}: 受け直す文言`);
    assert.ok(h.includes('href="/stylist/diagnosis"'), `${name}: 現役向け診断への案内は残る`);
  }
});

test("マイページの立場カード: 表示だけ。リンク・ボタン・フォームがなく、『変更する』『診断を受ける』も無い（全パターン）", () => {
  for (const [name, read] of CASES) {
    if (!read || read.status === "unsupported") continue; // 0071未適用はカードごと出さない
    const load = read.status === "ok" ? read : { status: "error" as const };
    const h = html(createElement(CareerPhaseSummary, { load }));
    assert.ok(!/<a |<button|<form|<input|<select/.test(h), `${name}: 操作要素なし`);
    const t = text(createElement(CareerPhaseSummary, { load }));
    assert.ok(!t.includes("変更する") && !t.includes("診断を受ける") && !t.includes("選ぶ") && !t.includes("設定する"), `${name}: 操作の文言なし`);
  }
  const shown = (v: Partial<typeof EMPTY_CAREER_PHASE>) => text(createElement(CareerPhaseSummary, { load: { status: "ok", value: { ...EMPTY_CAREER_PHASE, ...v } } }));
  assert.ok(shown({ phase: "new_graduate", graduationYm: "2027-03" }).includes("新卒"));
  assert.ok(shown({ phase: "experienced" }).includes("現役の美容師"));
  assert.ok(shown({ phase: "blank" }).includes("ブランクあり"));
  assert.ok(shown({}).includes("未選択") && shown({ legacyStudent: true }).includes("未選択"));
  const err = text(createElement(CareerPhaseSummary, { load: { status: "error" } }));
  assert.ok(err.includes("読み込めませんでした") && !err.includes("未選択"), "読み取り失敗は未選択と区別する");
});

test("保存済みの新卒診断の結果リンク: 立場カードとは別の導線として、過去の結果を見るリンクが残る（診断を始める操作ではない）", () => {
  const h = html(createElement(StudentPastResultLink));
  assert.ok(h.includes('href="/stylist/diagnosis/student/result"') && text(createElement(StudentPastResultLink)).includes("現在の結果ではありません"));
  const my = readFileSync("app/stylist/mypage/page.tsx", "utf8");
  assert.ok(my.includes('studentLink === "past" && <StudentPastResultLink />'));
  assert.ok(readFileSync("components/student-diagnosis/student-current-card.tsx", "utf8").includes("/stylist/diagnosis/student/result"), "現在の結果の詳細へのリンクは現在の診断カードに残る");
});

test("プロフィール編集: 立場の独立フォーム・独立の保存ボタンは無く、保存ボタンは1つ（変更を保存）。立場の欄は保存ボタンより上", () => {
  const pf = readFileSync("components/profile/profile-form.tsx", "utf8");
  assert.equal((pf.match(/type="submit"/g) ?? []).length, 1);
  assert.ok(pf.indexOf("<CareerPhaseField") > 0 && pf.indexOf("<CareerPhaseField") < pf.indexOf('type="submit"'));
  const page = readFileSync("app/stylist/profile/page.tsx", "utf8");
  for (const t of ["CareerPhaseForm", "saveCareerPhaseAction", "いまの立場を保存する", "いまの立場（任意）"]) assert.ok(!page.includes(t) && !pf.includes(t), t);
  for (const f of ["components/profile/career-phase-field.tsx", "components/profile/profile-form.tsx", "components/profile/stylist-onboarding-wizard.tsx", "app/stylist/profile/page.tsx"]) {
    const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const t of ["選ばない", "美容学生", "選ばなくても", "いまの立場を保存"]) assert.ok(!src.includes(t), `${f}: ${t}`);
  }
});

test("画面の構造: マイページ最下部と結果ページの『診断を始める』は、同じ判定（canStartStudentDiagnosis）を通る", () => {
  const my = readFileSync("app/stylist/mypage/page.tsx", "utf8");
  assert.ok(my.includes("hidePrimary={!canStartStudentDiagnosis(careerPhase)}"));
  const rs = readFileSync("app/stylist/diagnosis/student/result/page.tsx", "utf8");
  assert.ok(rs.includes('load.kind === "none" && canStartStudentDiagnosis(careerPhase)'));
  assert.ok(!/load\.kind === "none" && \(/.test(rs), "判定なしの『診断を始める』は残っていない");
  const dg = readFileSync("app/stylist/diagnosis/page.tsx", "utf8");
  assert.ok(dg.includes('phaseRead.value.phase === "new_graduate"'));
});
