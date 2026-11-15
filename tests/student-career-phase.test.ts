import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  describeCareerPhase, parseCareerPhaseInput, readOwnCareerPhase, EMPTY_CAREER_PHASE, currentYmJst,
  CAREER_PHASES, CAREER_PHASE_LABEL, CAREER_PHASE_REQUIRED_HEADING,
} from "@/lib/student-diagnosis/career-phase";
import { commitStudentDiagnosis, isMissingStudentFunction } from "@/lib/student-diagnosis/commit";
import { STUDENT_QUESTIONS, STUDENT_DIAGNOSIS_VERSION, type StudentAnswers } from "@/lib/student-diagnosis/questions";
import { computeStudentResult } from "@/lib/student-diagnosis/result";
import { StudentResultView } from "@/components/student-diagnosis/student-result-view";
import { CareerPhaseSummary } from "@/components/student-diagnosis/career-phase-summary";

const NOW = new Date("2026-11-15T09:00:00+09:00");
const ym = (d: number) => { const [y, m] = currentYmJst(NOW).split("-").map(Number); const i = y * 12 + (m - 1) + d; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`; };

test("立場: 必須。未選択・旧値(student)・不明な値は受け付けない。選べるのは3つだけ", () => {
  for (const bad of [{}, { phase: "" }, { phase: "  " }, { phase: null }, { phase: "student" }, { phase: "bogus" }, { phase: "EXPERIENCED" }]) {
    const r = parseCareerPhaseInput(bad as never, NOW);
    assert.equal(r.ok, false, JSON.stringify(bad));
    if (!r.ok) assert.ok(r.errors.phase);
  }
  assert.deepEqual(CAREER_PHASES, ["new_graduate", "experienced", "blank"]);
  assert.deepEqual(CAREER_PHASES.map((p) => CAREER_PHASE_LABEL[p]), ["新卒", "現役の美容師", "ブランクあり"]);
  assert.equal(CAREER_PHASE_REQUIRED_HEADING, "いまの立場（必須）");
});

test("立場: 現役・ブランクありは卒業・就業開始・免許を受け付けない", () => {
  for (const ph of ["experienced", "blank"] as const) {
    assert.deepEqual(parseCareerPhaseInput({ phase: ph }, NOW), { ok: true, value: { ...EMPTY_CAREER_PHASE, phase: ph } });
    for (const extra of [{ graduationYm: ym(1) }, { graduationKind: "planned" }, { desiredStartYm: ym(2) }, { licenseStatus: "obtained" }]) {
      assert.equal(parseCareerPhaseInput({ phase: ph, ...extra }, NOW).ok, false, `${ph} ${JSON.stringify(extra)}`);
    }
  }
});

test("立場: 新卒は卒業年月と卒業区分が必須（予定・済みの両方可）・免許は別項目", () => {
  assert.equal(parseCareerPhaseInput({ phase: "new_graduate", graduationYm: ym(6), graduationKind: "planned" }, NOW).ok, true);
  assert.equal(parseCareerPhaseInput({ phase: "new_graduate", graduationYm: ym(6), graduationKind: "planned", licenseStatus: "studying" }, NOW).ok, true);
  assert.equal(parseCareerPhaseInput({ phase: "new_graduate", graduationYm: ym(-2), graduationKind: "completed", licenseStatus: "obtained" }, NOW).ok, true);
  assert.equal(parseCareerPhaseInput({ phase: "new_graduate", graduationYm: ym(6) }, NOW).ok, false, "卒業区分なしは不可");
  assert.equal(parseCareerPhaseInput({ phase: "new_graduate", graduationKind: "planned" }, NOW).ok, false, "卒業年月なしは不可");
  assert.equal(parseCareerPhaseInput({ phase: "new_graduate", graduationYm: ym(2), graduationKind: "completed" }, NOW).ok, false, "未来の卒業済は不可");
  assert.equal(parseCareerPhaseInput({ phase: "new_graduate", graduationYm: ym(70), graduationKind: "planned" }, NOW).ok, false, "範囲外");
  assert.equal(parseCareerPhaseInput({ phase: "new_graduate", graduationYm: ym(6), graduationKind: "planned", desiredStartYm: ym(3) }, NOW).ok, false, "就業開始が卒業より前は不可");
  assert.equal(parseCareerPhaseInput({ phase: "new_graduate", graduationYm: "2027-13", graduationKind: "planned" }, NOW).ok, false);
  assert.equal(parseCareerPhaseInput({ phase: "new_graduate", graduationYm: ym(6), graduationKind: "planned", licenseStatus: "x" }, NOW).ok, false);
});

test("立場の表示: 未選択は何も出さない（旧データ含む）。3択は共通関数の文言。旧データは未選択と案内", () => {
  assert.equal(describeCareerPhase(EMPTY_CAREER_PHASE), null);
  assert.deepEqual(describeCareerPhase({ ...EMPTY_CAREER_PHASE, phase: "experienced" }), ["現役の美容師"]);
  assert.deepEqual(describeCareerPhase({ ...EMPTY_CAREER_PHASE, phase: "blank" }), ["ブランクあり"]);
  const l = describeCareerPhase({ ...EMPTY_CAREER_PHASE, phase: "new_graduate", graduationYm: "2027-03", graduationKind: "planned", desiredStartYm: "2027-04", licenseStatus: "studying" })!;
  assert.deepEqual(l, ["新卒", "2027年03月 卒業予定", "就業開始の希望: 2027年04月", "免許: 取得に向けて在学中"]);
  assert.equal(describeCareerPhase({ ...EMPTY_CAREER_PHASE, legacyStudent: true, graduationYm: "2027-03", graduationKind: "planned" }), null, "美容学生（旧）は新卒等へ変換せず未選択のまま");
  const sum = (v: typeof EMPTY_CAREER_PHASE, k: "current" | "past" | "none") => renderToStaticMarkup(createElement(CareerPhaseSummary, { value: v, studentLink: k })).replace(/<[^>]+>/g, " ");
  const unset = sum(EMPTY_CAREER_PHASE, "none");
  assert.ok(unset.includes("未選択") && unset.includes("選んでください") && !unset.includes("経験者") && !unset.includes("美容学生") && !unset.includes("未設定"));
  assert.ok(!unset.includes("診断を受ける"), "新卒以外には新卒向け診断を『受ける』入口を出さない");
  assert.ok(sum({ ...EMPTY_CAREER_PHASE, phase: "experienced" }, "none").indexOf("診断") < 0);
  assert.ok(sum({ ...EMPTY_CAREER_PHASE, phase: "new_graduate" }, "none").includes("新卒の診断を受ける"));
  assert.ok(sum(EMPTY_CAREER_PHASE, "current").includes("新卒の診断結果を見る"), "受けた結果へのリンクは立場にかかわらず残す");
  assert.ok(sum(EMPTY_CAREER_PHASE, "past").includes("現在の結果ではありません"));
});

test("区分の読み取り: 列なし(42703)はunsupported、その他の失敗はerror（未設定と取り違えない）", async () => {
  const mk = (res: unknown) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => res }) }) }) }) as never;
  assert.deepEqual(await readOwnCareerPhase(mk({ data: null, error: { code: "42703", message: "column stylist_profiles.career_phase does not exist" } }), "u"), { status: "unsupported" });
  assert.deepEqual(await readOwnCareerPhase(mk({ data: null, error: { code: "PGRST301", message: "JWT expired" } }), "u"), { status: "error" });
  assert.deepEqual(await readOwnCareerPhase(mk({ data: null, error: null }), "u"), { status: "ok", value: EMPTY_CAREER_PHASE });
  // 旧データの美容学生は、新卒等へ勝手に変換しない（未選択として返し、旧データだったことだけ保持する）
  const ok = await readOwnCareerPhase(mk({ data: { career_phase: "student", graduation_ym: "2027-03-01", graduation_kind: "planned", desired_start_ym: null, license_status: "studying" }, error: null }), "u");
  assert.deepEqual(ok, { status: "ok", value: { phase: null, legacyStudent: true, graduationYm: "2027-03", graduationKind: "planned", desiredStartYm: null, licenseStatus: "studying" } });
  const blank = await readOwnCareerPhase(mk({ data: { career_phase: "blank", graduation_ym: null, graduation_kind: null, desired_start_ym: null, license_status: null }, error: null }), "u");
  assert.deepEqual(blank, { status: "ok", value: { ...EMPTY_CAREER_PHASE, phase: "blank" } });
});

// ---- 学生診断の確定保存 ----
const answers: StudentAnswers = {};
for (const q of STUDENT_QUESTIONS) {
  if (q.kind === "single") answers[q.id] = ["a"];
  else if (q.kind === "multi" && q.min >= 1) answers[q.id] = ["a"];
  else if (q.kind === "ranked") answers[q.id] = [q.options[0].id, q.options[1].id];
}
const REQ = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

test("学生診断の保存: サーバーが回答から結果を作り直して commit_student_diagnosis へ渡す（画面の結果は使わない）", async () => {
  let call: { name: string; args: Record<string, unknown> } | null = null;
  const client = { rpc: async (name: string, args: Record<string, unknown>) => { call = { name, args }; return { data: { result_id: "r1", action: "initial", replay: false, locked_until: null }, error: null }; } };
  const r = await commitStudentDiagnosis(client, { userId: "u1", requestId: REQ, answers });
  assert.equal(r.ok, true);
  assert.equal(call!.name, "commit_student_diagnosis");
  assert.deepEqual(call!.args, { p_user_id: "u1", p_request_id: REQ, p_version: STUDENT_DIAGNOSIS_VERSION, p_answers: answers, p_result: computeStudentResult(answers, STUDENT_DIAGNOSIS_VERSION) });
});

test("学生診断の保存: 不正な回答・送信IDはDBへ送らない", async () => {
  let n = 0; const client = { rpc: async () => { n++; return { data: null, error: null }; } };
  assert.equal((await commitStudentDiagnosis(client, { userId: "u", requestId: REQ, answers: { q1: ["z"] } })).ok, false);
  assert.equal((await commitStudentDiagnosis(client, { userId: "u", requestId: "x", answers })).ok, false);
  assert.equal(n, 0);
});

test("学生診断の保存: ロック中・競合・通信切れ・0071未適用を正しく区別し、旧経路へ戻らない", async () => {
  const run = (res: unknown | "throw") => commitStudentDiagnosis({ rpc: async () => { if (res === "throw") throw new Error("net"); return res as never; } }, { userId: "u", requestId: REQ, answers });
  const locked = await run({ data: null, error: { code: "P0001", message: "diagnosis_change_locked", details: "2027-02-13T00:00:00Z" } });
  assert.ok(!locked.ok && locked.error.code === "locked" && !locked.unsupported && locked.error.lockedUntil);
  const busy = await run({ data: null, error: { code: "40P01", message: "deadlock detected" } });
  assert.ok(!busy.ok && busy.error.code === "busy");
  const lost = await run("throw");
  assert.ok(!lost.ok && lost.error.code === "uncertain" && !lost.error.definite, "結果不明は『数えていません』と断定しない");
  const missing = await run({ data: null, error: { code: "PGRST202", message: "Could not find the function public.commit_student_diagnosis(...)" } });
  assert.ok(!missing.ok && missing.unsupported);
  const other = await run({ data: null, error: { code: "PGRST202", message: "Could not find the function public.commit_diagnosis_result" } });
  assert.ok(!other.ok && !other.unsupported, "別の関数の欠落は未対応扱いにしない");
  assert.equal(isMissingStudentFunction({ code: "42501", message: "permission denied for function commit_student_diagnosis" }), false);
  const replay = await run({ data: { result_id: "r9", action: "initial", replay: true, locked_until: null }, error: null });
  assert.ok(replay.ok && replay.replay);
});

test("学生診断のアプリ: 既存診断・採点・旧INSERTを使わず、0071未適用では入口を出さない", () => {
  const files = ["lib/student-diagnosis/commit.ts", "lib/student-diagnosis/actions.ts", "app/stylist/diagnosis/student/page.tsx"].map((f) => readFileSync(f, "utf8")).join("\n");
  assert.ok(!/scoreTraits|marketValue|commit_diagnosis_result|from\("diagnosis_results"\)|\.insert\(/.test(files.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
  const entry = readFileSync("app/stylist/diagnosis/page.tsx", "utf8");
  // 新卒向け診断の入口は、0071適用済みで、立場が「新卒」のときだけ。美容学生の入口は無い
  assert.ok(entry.includes('phaseRead?.status === "ok" && phaseRead.value.phase === "new_graduate"'));
  assert.ok(!entry.includes("美容学生") && !entry.includes("在学中"));
  // 立場は、プロフィール保存と別に保存する画面・関数を持たない（プロフィール編集の入力欄から v3 で一緒に保存）
  const profile = readFileSync("app/stylist/profile/page.tsx", "utf8");
  assert.ok(!profile.includes("CareerPhaseForm") && !profile.includes("saveCareerPhaseAction"));
  assert.ok(!readFileSync("lib/student-diagnosis/actions.ts", "utf8").includes("set_stylist_career_phase"));
  assert.ok(!existsSync("components/student-diagnosis/career-phase-form.tsx"));
});

test("結果表示: 点数・割合・順位・禁止語を出さず、同数は同列のチップ", () => {
  const r = computeStudentResult(answers, STUDENT_DIAGNOSIS_VERSION);
  const h = renderToStaticMarkup(createElement(StudentResultView, { result: r }));
  assert.ok(!/[0-9]+\s*(点|%|％|位)|即戦力|高い技術|実力|才能|市場価値|年収|ランク/.test(h.replace(/<[^>]+>/g, "")), "禁止語・数値なし");
  assert.ok(h.includes("次の一手") && h.includes("見学"));
});
