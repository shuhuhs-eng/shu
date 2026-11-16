import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  describeCareerPhase, formatBlankPeriod, parseCareerPhaseInput, readOwnCareerPhase, EMPTY_CAREER_PHASE, currentYmJst,
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

test("立場: 現役は卒業年月・ブランク期間を受け付けない。ブランクありは卒業年月を受け付けない", () => {
  assert.deepEqual(parseCareerPhaseInput({ phase: "experienced" }, NOW), { ok: true, value: { ...EMPTY_CAREER_PHASE, phase: "experienced" } });
  assert.deepEqual(parseCareerPhaseInput({ phase: "blank" }, NOW), { ok: true, value: { ...EMPTY_CAREER_PHASE, phase: "blank" } });
  for (const extra of [{ graduationYear: "2027" }, { graduationMonth: "3" }, { blankPeriodValue: "6" }]) assert.equal(parseCareerPhaseInput({ phase: "experienced", ...extra }, NOW).ok, false, JSON.stringify(extra));
  for (const extra of [{ graduationYear: "2027" }, { graduationMonth: "3" }]) assert.equal(parseCareerPhaseInput({ phase: "blank", ...extra }, NOW).ok, false, JSON.stringify(extra));
});

test("立場: 新卒は卒業（予定）の年と月（3月/10月）が必須。それ以外の項目（区分・就業開始・免許）は不要で、送られても使わない", () => {
  const ok = parseCareerPhaseInput({ phase: "new_graduate", graduationYear: "2027", graduationMonth: "3" }, NOW);
  assert.deepEqual(ok, { ok: true, value: { phase: "new_graduate", legacyStudent: false, graduationYm: "2027-03", blankPeriod: null } });
  assert.deepEqual(parseCareerPhaseInput({ phase: "new_graduate", graduationYear: "2027", graduationMonth: "10" }, NOW), { ok: true, value: { phase: "new_graduate", legacyStudent: false, graduationYm: "2027-10", blankPeriod: null } });
  assert.equal(parseCareerPhaseInput({ phase: "new_graduate", graduationYear: "2027", graduationMonth: "03" }, NOW).ok, true, "03 も3月");
  for (const m of [1, 2, 4, 5, 6, 7, 8, 9, 11, 12, 0, 13]) assert.equal(parseCareerPhaseInput({ phase: "new_graduate", graduationYear: "2027", graduationMonth: String(m) }, NOW).ok, false, `${m}月`);
  for (const bad of [{}, { graduationYear: "2027" }, { graduationMonth: "3" }, { graduationYear: "", graduationMonth: "" }, { graduationYear: "abc", graduationMonth: "3" }, { graduationYear: "2027", graduationMonth: "x" }]) assert.equal(parseCareerPhaseInput({ phase: "new_graduate", ...bad }, NOW).ok, false, JSON.stringify(bad));
  assert.equal(parseCareerPhaseInput({ phase: "new_graduate", graduationYear: "2023", graduationMonth: "10" }, NOW).ok, false, "範囲外（3年より前）");
  assert.equal(parseCareerPhaseInput({ phase: "new_graduate", graduationYear: "2032", graduationMonth: "3" }, NOW).ok, false, "範囲外（5年より後）");
  assert.equal(parseCareerPhaseInput({ phase: "new_graduate", graduationYear: "2027", graduationMonth: "3", blankPeriodValue: "6" }, NOW).ok, false, "ブランク期間は付けられない");
  // 旧入力名（卒業の区分・就業開始・免許）は結果に現れない
  const withOld = parseCareerPhaseInput({ phase: "new_graduate", graduationYear: "2027", graduationMonth: "3", graduationKind: "planned", desiredStartYm: "2027-04", licenseStatus: "obtained" } as never, NOW);
  assert.deepEqual(withOld, ok);
});

test("立場: ブランク期間は任意。数値（正の整数）＋単位（ヶ月/年）。0・負数・小数・不正値・上限超えは不可。未入力を0ヶ月にしない", () => {
  const r = (v: unknown, u?: unknown) => parseCareerPhaseInput({ phase: "blank", blankPeriodValue: v, blankPeriodUnit: u }, NOW);
  assert.deepEqual(r("6", "months"), { ok: true, value: { ...EMPTY_CAREER_PHASE, phase: "blank", blankPeriod: { value: 6, unit: "months" } } });
  assert.deepEqual(r("2", "years"), { ok: true, value: { ...EMPTY_CAREER_PHASE, phase: "blank", blankPeriod: { value: 2, unit: "years" } } });
  assert.deepEqual(r("120", "months").ok && (r("120", "months") as { value: { blankPeriod: unknown } }).value.blankPeriod, { value: 120, unit: "months" });
  for (const [v, u] of [["121", "months"], ["11", "years"], ["15", "years"], ["720", "months"], ["60", "years"]]) assert.equal(r(v, u).ok, true, `${v}${u}: 10年を超えるブランクも入力できる`);
  for (const e of [undefined, "", "  ", null]) assert.deepEqual(r(e, "months"), { ok: true, value: { ...EMPTY_CAREER_PHASE, phase: "blank" } }, "空欄は未入力（blankPeriod=null。0ヶ月ではない）");
  for (const bad of ["0", "-1", "1.5", "1,5", "abc", "6ヶ月", "６", "01", "+3", "1e2", " "]) if (bad.trim()) assert.equal(r(bad, "months").ok, false, `値 ${bad}`);
  assert.equal(r("721", "months").ok, false); assert.equal(r("61", "years").ok, false); assert.equal(r("9999", "months").ok, false);
  assert.equal(r("6", "weeks").ok, false); assert.equal(r("6", "").ok, false); assert.equal(r("6", undefined).ok, false);
});

test("卒業年・ブランク期間の表示: 「2027年3月」「6ヶ月」「2年」。未入力は何も出さない", () => {
  assert.deepEqual(formatBlankPeriod({ value: 6, unit: "months" }), "6ヶ月"); assert.equal(formatBlankPeriod({ value: 2, unit: "years" }), "2年");
  assert.deepEqual(describeCareerPhase({ ...EMPTY_CAREER_PHASE, phase: "blank", blankPeriod: { value: 6, unit: "months" } }), ["ブランクあり", "ブランク期間: 6ヶ月"]);
  assert.deepEqual(describeCareerPhase({ ...EMPTY_CAREER_PHASE, phase: "blank", blankPeriod: { value: 2, unit: "years" } }), ["ブランクあり", "ブランク期間: 2年"]);
  assert.deepEqual(describeCareerPhase({ ...EMPTY_CAREER_PHASE, phase: "new_graduate", graduationYm: "2027-03" }), ["新卒", "卒業（予定）: 2027年3月"]);
  assert.deepEqual(describeCareerPhase({ ...EMPTY_CAREER_PHASE, phase: "new_graduate", graduationYm: "2027-10" }), ["新卒", "卒業（予定）: 2027年10月"]);
  assert.deepEqual(describeCareerPhase({ ...EMPTY_CAREER_PHASE, phase: "experienced" }), ["現役の美容師"]);
  assert.deepEqual(describeCareerPhase({ ...EMPTY_CAREER_PHASE, phase: "blank" }), ["ブランクあり"], "未入力は何も出さない");
  assert.equal(describeCareerPhase(EMPTY_CAREER_PHASE), null);
  assert.equal(describeCareerPhase({ ...EMPTY_CAREER_PHASE, legacyStudent: true, graduationYm: "2027-03" }), null, "美容学生（旧）は新卒等へ変換せず未選択のまま");
  const sum = (v: typeof EMPTY_CAREER_PHASE) => renderToStaticMarkup(createElement(CareerPhaseSummary, { load: { status: "ok", value: v } })).replace(/<[^>]+>/g, " ");
  const unset = sum(EMPTY_CAREER_PHASE);
  assert.ok(unset.includes("未選択") && !unset.includes("経験者") && !unset.includes("美容学生") && !unset.includes("未設定"));
  assert.ok(sum({ ...EMPTY_CAREER_PHASE, phase: "experienced" }).includes("現役の美容師"));
  // マイページのカードは立場名だけ（卒業年月・ブランク期間は出さない。詳細はプロフィール編集と本人プレビュー）
  const ng = sum({ ...EMPTY_CAREER_PHASE, phase: "new_graduate", graduationYm: "2027-03" });
  assert.ok(ng.includes("新卒") && !/卒業|2027|3月/.test(ng));
  const bl = sum({ ...EMPTY_CAREER_PHASE, phase: "blank", blankPeriod: { value: 6, unit: "months" } });
  assert.ok(bl.includes("ブランクあり") && !/ブランク期間|6ヶ月/.test(bl));
  const bl2 = sum({ ...EMPTY_CAREER_PHASE, phase: "blank", blankPeriod: { value: 2, unit: "years" } });
  assert.ok(bl2.includes("ブランクあり") && !/ブランク期間|2年/.test(bl2));
  const html = renderToStaticMarkup(createElement(CareerPhaseSummary, { load: { status: "ok", value: { ...EMPTY_CAREER_PHASE, phase: "blank", blankPeriod: { value: 6, unit: "months" } } } }));
  assert.ok(!html.includes("<a ") && !html.includes("<button"), "表示のみ（リンク・ボタンなし）");
});

test("区分の読み取り: 列なし(42703)はunsupported、その他の失敗はerror（未設定と取り違えない）", async () => {
  const mk = (res: unknown) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => res }) }) }) }) as never;
  assert.deepEqual(await readOwnCareerPhase(mk({ data: null, error: { code: "42703", message: "column stylist_profiles.career_phase does not exist" } }), "u"), { status: "unsupported" });
  assert.deepEqual(await readOwnCareerPhase(mk({ data: null, error: { code: "PGRST301", message: "JWT expired" } }), "u"), { status: "error" });
  assert.deepEqual(await readOwnCareerPhase(mk({ data: null, error: null }), "u"), { status: "ok", value: EMPTY_CAREER_PHASE });
  // 旧データの美容学生は、新卒等へ勝手に変換しない（未選択として返し、旧データだったことだけ保持する）。旧3項目は読まない
  const ok = await readOwnCareerPhase(mk({ data: { career_phase: "student", graduation_ym: "2027-03-01", blank_period_value: null, blank_period_unit: null, graduation_kind: "planned", license_status: "studying" }, error: null }), "u");
  assert.deepEqual(ok, { status: "ok", value: { phase: null, legacyStudent: true, graduationYm: "2027-03", blankPeriod: null } });
  const blank = await readOwnCareerPhase(mk({ data: { career_phase: "blank", graduation_ym: null, blank_period_value: 6, blank_period_unit: "months" }, error: null }), "u");
  assert.deepEqual(blank, { status: "ok", value: { ...EMPTY_CAREER_PHASE, phase: "blank", blankPeriod: { value: 6, unit: "months" } } });
  // 片方だけ・範囲外のブランク期間は未入力として扱う（補わない）
  for (const row of [{ blank_period_value: 6, blank_period_unit: null }, { blank_period_value: null, blank_period_unit: "years" }, { blank_period_value: 0, blank_period_unit: "months" }]) {
    const r = await readOwnCareerPhase(mk({ data: { career_phase: "blank", graduation_ym: null, ...row }, error: null }), "u");
    assert.deepEqual(r, { status: "ok", value: { ...EMPTY_CAREER_PHASE, phase: "blank" } }, JSON.stringify(row));
  }
  // 卒業月が3月/10月以外の既存データは、丸めずそのまま返す（画面で選び直しを案内）
  const may = await readOwnCareerPhase(mk({ data: { career_phase: "new_graduate", graduation_ym: "2027-05-01", blank_period_value: null, blank_period_unit: null }, error: null }), "u");
  assert.deepEqual(may, { status: "ok", value: { phase: "new_graduate", legacyStudent: false, graduationYm: "2027-05", blankPeriod: null } });
  // ブランク期間の列が無い（0076未適用）は「未対応」ではなくエラー（旧い保存経路へ切り替えない）
  assert.deepEqual(await readOwnCareerPhase(mk({ data: null, error: { code: "42703", message: "column stylist_profiles.blank_period_value does not exist" } }), "u"), { status: "error" });
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
  // 入口は共通の30問に統一（方針変更）。15問の新卒向け診断へ誘導するバナー・リンクは出さない。立場は診断で変えない。美容学生の入口も無い
  assert.ok(!entry.includes("/stylist/diagnosis/student") && !entry.includes("新卒向けの診断へ"));
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
