// 新卒向け診断の「受ける・始める・受け直す」入口は、立場が「新卒」のときだけ。保存済みの結果を見るリンクは残す。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canStartStudentDiagnosis, EMPTY_CAREER_PHASE, type CareerPhaseRead } from "../lib/student-diagnosis/career-phase";
import { RetakeLink } from "../components/mypage/retake-link";
import { CareerPhaseSummary } from "../components/student-diagnosis/career-phase-summary";

const ok = (v: Partial<typeof EMPTY_CAREER_PHASE>): CareerPhaseRead => ({ status: "ok", value: { ...EMPTY_CAREER_PHASE, ...v } });
const CASES: [string, CareerPhaseRead | null, boolean][] = [
  ["新卒", ok({ phase: "new_graduate", graduationYm: "2027-03", graduationKind: "planned" }), true],
  ["現役の美容師", ok({ phase: "experienced" }), false],
  ["ブランクあり", ok({ phase: "blank" }), false],
  ["未選択（未設定）", ok({}), false],
  ["未選択（旧・美容学生）", ok({ legacyStudent: true, graduationYm: "2027-03", graduationKind: "planned" }), false],
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

test("マイページの立場カード: 『診断を受ける』は新卒だけ。結果を見るリンク（現在・過去）は立場にかかわらず残る", () => {
  for (const [name, read, want] of CASES) {
    const v = read && read.status === "ok" ? read.value : EMPTY_CAREER_PHASE;
    assert.equal(text(createElement(CareerPhaseSummary, { value: v, studentLink: "none" })).includes("新卒の診断を受ける"), want, name);
    assert.ok(text(createElement(CareerPhaseSummary, { value: v, studentLink: "current" })).includes("新卒の診断結果を見る"), `${name}: 現在の結果リンク`);
    assert.ok(text(createElement(CareerPhaseSummary, { value: v, studentLink: "past" })).includes("過去の新卒診断の結果を見る"), `${name}: 過去の結果リンク`);
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
