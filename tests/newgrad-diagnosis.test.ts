/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Q, QS } from "../lib/diagnosis/questions";
import { Q_NEWGRAD } from "../lib/diagnosis/newgrad-questions";
import { NEWGRAD_TYPE_CONTENT, NEWGRAD_COMMON_NOTE } from "../lib/diagnosis/newgrad-content";
import { NEWGRAD_VERSION, NEWGRAD_ENTRY_INDEX, ENTRY_QUESTION, isNewgradEntryEnabled, entryQuestionFor, bankForVersion, questionIdsOf, quizBankFor, setFromFirstAnswer, versionOfSet, submissionErrorNotice, NEWGRAD_CLOSED_MESSAGE } from "../lib/diagnosis/newgrad";
import { resolveDiagnosis, verifySubmission } from "../lib/diagnosis/versioned";
import { computeDiagnosis } from "../lib/diagnosis/index";
import { scoreTraits } from "../lib/diagnosis/scoring";
import { calculateCoreType, CORE_TYPE_CODES } from "../lib/diagnosis/core-types";
import { planFirstAnswerChange, answersAfterSwitch } from "../lib/diagnosis/quiz-switch";
import { isUnrecoverableStartError } from "../lib/diagnosis-handoff/claim-errors";
import { DIAGNOSIS_VERSION } from "../lib/diagnosis/version";

const SRC = "docs/student-newgrad-30/source/";
const design = JSON.parse(readFileSync(SRC + "newgrad30_scoring_design.json", "utf8"));
const verification = JSON.parse(readFileSync(SRC + "design_verification.json", "utf8"));

test("新卒版の質問・選択肢・配点は、設計JSON（正本）とすべて一致する（テストに合わせて変えていない）", () => {
  assert.equal(Q_NEWGRAD.length, 30);
  design.questions.forEach((q: any, i: number) => {
    assert.equal(Q_NEWGRAD[i].q, q.question);
    assert.equal(Q_NEWGRAD[i].opts.length, q.options.length);
    q.options.forEach((o: any, j: number) => { assert.equal(Q_NEWGRAD[i].opts[j].t, o.text); assert.deepEqual(Q_NEWGRAD[i].opts[j].w, o.weights); });
  });
});

test("新卒版: 1問目・3問目は全選択肢が採点対象外（分子・分母に入らない）。残り28問が採点対象", () => {
  for (const i of [0, 2]) assert.ok(Q_NEWGRAD[i].opts.every((o) => Object.keys(o.w).length === 0), `問${i + 1}`);
  assert.equal(Q_NEWGRAD.filter((q) => q.opts.some((o) => Object.keys(o.w).length)).length, 28);
  // 3問目の回答を変えても、1問目の添字が新卒のままなら結果は変わらない（同点の解消にも使われない）
  const base = Q_NEWGRAD.map((q, i) => (i === 0 ? 4 : i % q.opts.length));
  const r0 = scoreTraits(base, Q_NEWGRAD).traits;
  for (let a = 0; a < 5; a++) { const x = [...base]; x[2] = a; assert.deepEqual(scoreTraits(x, Q_NEWGRAD).traits, r0); }
  // 分母（各問の最大点の合計）は設計の検証JSONと同じで、回答内容で変わらない
  const den: Record<string, number> = { T: 0, S: 0, H: 0, B: 0, A: 0, M: 0 };
  for (const q of Q_NEWGRAD) for (const k of Object.keys(den)) den[k] += Math.max(0, ...q.opts.map((o) => (o.w as any)[k] ?? 0));
  assert.deepEqual(den, verification.simulation.denominators);
});

test("新卒版: 設計の到達例（8タイプ）を、実装の採点で再現する（軸・8タイプの得点・差・1位）", () => {
  for (const [type, w] of Object.entries<any>(verification.witnesses)) {
    const { traits } = scoreTraits(w.answers, Q_NEWGRAD);
    assert.deepEqual(traits, w.scores, type);
    const c = calculateCoreType(traits);
    assert.equal(c.topType, type);
    for (const code of CORE_TYPE_CODES) assert.equal(c.matchScores[code], w.match_scores[code], `${type}/${code}`);
    assert.equal(c.scoreGap, w.gap);
    const r = resolveDiagnosis("stylist", w.answers, NEWGRAD_VERSION);
    assert.equal(r.kind, "ok");
  }
});

test("新卒版の説明文は8タイプすべてにあり、設計メモの共通注記・禁止表現の注意を持つ。能力・年収・市場価値の語を含まない", () => {
  assert.equal(Object.keys(NEWGRAD_TYPE_CONTENT).length, 8);
  for (const c of CORE_TYPE_CODES) {
    const t = NEWGRAD_TYPE_CONTENT[c];
    assert.ok(t.headline && t.body && t.tendency && t.tryThis && t.writerNote, c);
    const shown = [t.headline, t.body, t.tendency, t.tryThis].join("");
    // 「評価ではありません」のような否定の文脈は設計の文言なので、断定的な用語だけを確認する
    for (const bad of ["市場価値", "年収", "ランク", "上位", "S級", "最強"]) assert.ok(!shown.includes(bad), `${c}: ${bad}`);
  }
  assert.ok(NEWGRAD_COMMON_NOTE.includes("評価するものではありません"));
});

test("共通入口: 1問目の選択肢0〜3は経験者版の p1 と同じ文言・同じ添字。5つ目（添字4）が新卒。質問IDは1問目以外、セットで別", () => {
  for (let j = 0; j < 4; j++) assert.equal(ENTRY_QUESTION.opts[j].t, Q[0].opts[j].t);
  assert.equal(ENTRY_QUESTION.opts.length, 5);
  assert.equal(NEWGRAD_ENTRY_INDEX, 4);
  assert.equal(setFromFirstAnswer(4), "newgrad");
  for (const a of [0, 1, 2, 3]) assert.equal(setFromFirstAnswer(a), "experienced");
  for (const a of [-1, 5, 1.5, null, undefined, "1", NaN]) assert.equal(setFromFirstAnswer(a), null);
  const ex = questionIdsOf("experienced"), ng = questionIdsOf("newgrad");
  assert.equal(ex[0], ng[0]);
  for (let i = 1; i < 30; i++) assert.notEqual(ex[i], ng[i], `問${i + 1}のIDが両セットで別`);
  // 経験者セットの2問目以降は既存 Q そのまま（質問・配点は変更していない）
  assert.deepEqual(quizBankFor("experienced").slice(1), Q.slice(1));
});

test("経験者版: 既存の computeDiagnosis と、版 1.0.0 での resolveDiagnosis／verifySubmission の結果が、乱数回答3,000件で完全に一致する（市場価値・年収を含む）", () => {
  let seed = 3; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let n = 0; n < 3000; n++) {
    const a = Q.map((q) => Math.floor(rnd() * q.opts.length));
    const base = computeDiagnosis("stylist", a);
    const r = resolveDiagnosis("stylist", a, DIAGNOSIS_VERSION);
    assert.ok(r.kind === "ok"); if (r.kind === "ok") assert.deepEqual(r.computed, base);
    const v = verifySubmission("stylist", a, { setVersion: DIAGNOSIS_VERSION, questionIds: questionIdsOf("experienced") });
    assert.ok(v.ok); if (v.ok) assert.deepEqual(v.computed, base);
  }
  const sa = QS.map((q) => q.opts.length - 1);
  assert.deepEqual(resolveDiagnosis("salon", sa, DIAGNOSIS_VERSION), { kind: "ok", computed: computeDiagnosis("salon", sa), set: "experienced" });
});

test("新卒版: 版名・市場価値null・年収null・経験年数の既定値を使わない。12タイプの内部値は保存互換のためだけに計算する", () => {
  const a = Q_NEWGRAD.map((q, i) => (i === 0 ? 4 : i % q.opts.length));
  const r = resolveDiagnosis("stylist", a, NEWGRAD_VERSION);
  assert.ok(r.kind === "ok");
  if (r.kind === "ok") {
    assert.equal(r.computed.diagnosisVersion, NEWGRAD_VERSION);
    assert.equal(r.computed.marketValueScore, null);
    assert.equal(r.computed.salaryBand, null);
    assert.ok(r.computed.typeId && r.computed.typeName);
  }
  assert.equal(versionOfSet("newgrad"), "stylist_newgrad_30_v1");
});

test("版による分類: 知らない版は unknown_version（破損ではない）、版は合うが回答が合わないのは corrupt。サロンに新卒版は無い", () => {
  const ng = Q_NEWGRAD.map((q, i) => (i === 0 ? 4 : 0));
  const ex = Q.map(() => 0);
  assert.equal(resolveDiagnosis("stylist", ng, "stylist_newgrad_30_v2").kind, "unknown_version");
  assert.equal(resolveDiagnosis("stylist", ng, "").kind, "unknown_version");
  assert.equal(resolveDiagnosis("stylist", ng, null).kind, "unknown_version");
  assert.equal(resolveDiagnosis("stylist", ng, "2.0.0").kind, "unknown_version");
  assert.equal(resolveDiagnosis("salon", ng, NEWGRAD_VERSION).kind, "unknown_version");
  assert.equal(resolveDiagnosis("stylist", ng, DIAGNOSIS_VERSION).kind, "corrupt", "新卒の回答（1問目=4）を経験者の版で読む");
  assert.equal(resolveDiagnosis("stylist", ex, NEWGRAD_VERSION).kind, "corrupt", "1問目が新卒でない回答を新卒の版で読む");
  assert.equal(resolveDiagnosis("stylist", ng.slice(1), NEWGRAD_VERSION).kind, "corrupt");
  assert.equal(resolveDiagnosis("stylist", ng.map((a, i) => (i === 5 ? 9 : a)), NEWGRAD_VERSION).kind, "corrupt");
  assert.equal(resolveDiagnosis("stylist", "x", NEWGRAD_VERSION).kind, "corrupt");
  assert.equal(bankForVersion("stylist", NEWGRAD_VERSION)?.bank, Q_NEWGRAD);
});

test("送信の検証: 公式な版はサーバーが1問目から決め、申告（版・質問ID）は並びの照合だけに使う", () => {
  const ng = Q_NEWGRAD.map((q, i) => (i === 0 ? 4 : 1));
  const ex = Q.map((q, i) => (i === 0 ? 2 : 1));
  const ngD = { setVersion: NEWGRAD_VERSION, questionIds: questionIdsOf("newgrad") }, exD = { setVersion: DIAGNOSIS_VERSION, questionIds: questionIdsOf("experienced") };
  assert.deepEqual(verifySubmission("stylist", ng, ngD).ok, true);
  assert.deepEqual(verifySubmission("stylist", ex, exD).ok, true);
  assert.deepEqual(verifySubmission("stylist", ex, undefined).ok, true, "古い画面（申告なし）は経験者の形のときだけ");
  assert.deepEqual(verifySubmission("stylist", ng, undefined), { ok: false, error: "set_mismatch" });
  assert.deepEqual(verifySubmission("stylist", ng, exD), { ok: false, error: "set_mismatch" });
  assert.deepEqual(verifySubmission("stylist", ex, ngD), { ok: false, error: "set_mismatch" });
  assert.deepEqual(verifySubmission("stylist", ng, { setVersion: NEWGRAD_VERSION }), { ok: false, error: "set_mismatch" }, "質問IDが無い");
  assert.deepEqual(verifySubmission("stylist", ng, { setVersion: "stylist_newgrad_30_v9", questionIds: ngD.questionIds }), { ok: false, error: "set_mismatch" });
  assert.deepEqual(verifySubmission("stylist", [9, ...ng.slice(1)], ngD), { ok: false, error: "invalid_answers" });
  assert.deepEqual(verifySubmission("stylist", ng.slice(0, 29), ngD), { ok: false, error: "invalid_answers" });
  // 限界の明示: 1問目が新卒でも、2問目以降の回答が実際に新卒版の質問で選ばれたかは、サーバーには証明できない
  // （添字の範囲が同じなら、経験者の質問に答えた添字を新卒の並びとして申告した送信も、形式上は通る）。
  const mixed = [4, ...Q.slice(1).map(() => 0)];
  assert.equal(verifySubmission("stylist", mixed, ngD).ok, true, "意味の混在までは検出できない（既知の限界）");
});

test("1問目の切り替え: 別のセットで2問目以降に回答があれば確認、無ければすぐ切り替え。同じセット・1問目以外・サロンは常に何も起きない。切り替えで2問目以降はすべて消える", () => {
  const filled = Array.from({ length: 30 }, (_, i) => (i === 0 ? 1 : 2));
  const onlyFirst = Array.from({ length: 30 }, (_, i) => (i === 0 ? 1 : null));
  assert.equal(planFirstAnswerChange("stylist", 0, filled, 4), "confirm");
  assert.equal(planFirstAnswerChange("stylist", 0, onlyFirst, 4), "switch");
  assert.equal(planFirstAnswerChange("stylist", 0, filled, 3), "same", "経験者の中の変更");
  assert.equal(planFirstAnswerChange("stylist", 0, Array(30).fill(null), 4), "same", "初回の回答");
  const ng = Array.from({ length: 30 }, (_, i) => (i === 0 ? 4 : 2));
  assert.equal(planFirstAnswerChange("stylist", 0, ng, 0), "confirm", "新卒→経験者");
  assert.equal(planFirstAnswerChange("stylist", 3, filled, 4), "same");
  assert.equal(planFirstAnswerChange("salon", 0, filled, 4), "same");
  const after = answersAfterSwitch(30, 4);
  assert.equal(after[0], 4); assert.ok(after.slice(1).every((a) => a === null));
});

test("引き継ぎの失敗分類: Cookieを消してよいのは、期限切れ・他人が処理中・完了済み・存在しないと明確に確認できた場合だけ", () => {
  const notFound = "pending diagnosis not found, claimed by someone else, already completed, or expired";
  assert.equal(isUnrecoverableStartError({ code: "P0001", message: notFound }), true);
  // 次はすべて「障害の解消で直る」ので消さない（関数未反映・権限不足・認証の一時的な不整合・通信・タイムアウト・HTTP 4xx/5xx・不明）
  for (const e of [
    { code: "PGRST202", message: "Could not find the function public.start_pending_diagnosis_claim" }, { code: "42883", message: "function does not exist" },
    { code: "42501", message: "permission denied for function" }, { code: "P0001", message: "not authenticated" }, { code: "P0001", message: "something else" },
    { message: "TypeError: fetch failed" }, { code: "57014", message: "timeout" }, { code: "08006", message: "connection" }, { status: 404, message: "x" }, { status: 401, message: "x" },
    { status: 503, message: "x" }, { message: notFound }, { code: "XX000", message: notFound }, { message: "unknown" }, null, undefined,
  ]) assert.equal(isUnrecoverableStartError(e as never), false, JSON.stringify(e));
});

test("公開スイッチ: true/1/on のときだけ有効（未設定・他の値は無効）。無効の間は1問目の5つ目を出さず、新卒の送信は newgrad_disabled", () => {
  for (const v of [undefined, "", "false", "0", "off", "yes", "enabled", "tru"]) assert.equal(isNewgradEntryEnabled({ NEWGRAD_ENTRY_ENABLED: v }), false, `既定・その他は無効: ${String(v)}`);
  for (const v of ["true", "1", "on", " TRUE ", "On"]) assert.equal(isNewgradEntryEnabled({ NEWGRAD_ENTRY_ENABLED: v }), true, v);
  assert.equal(entryQuestionFor(true).opts.length, 5);
  assert.equal(entryQuestionFor(false).opts.length, 4);
  assert.deepEqual(entryQuestionFor(false).opts, Q[0].opts.map((o) => ({ t: o.t, w: {} })));
  const ng = Q_NEWGRAD.map((q, i) => (i === 0 ? 4 : 1));
  const d = { setVersion: NEWGRAD_VERSION, questionIds: questionIdsOf("newgrad") };
  assert.deepEqual(verifySubmission("stylist", ng, d, { newgradEnabled: false }), { ok: false, error: "newgrad_disabled" });
  assert.equal(verifySubmission("stylist", ng, d, { newgradEnabled: true }).ok, true);
  assert.equal(verifySubmission("stylist", Q.map((q, i) => (i === 0 ? 1 : 0)), undefined, { newgradEnabled: false }).ok, true);
});

test("新卒向けAI指示: 6軸の数値・市場価値・年収を渡さず、禁止事項（評価・断定・優劣・年収）と注記を含む。版は newgrad-1.0.0 系", async () => {
  const { buildNewgradPrompt } = await import("../lib/ai/generate-diagnosis-narrative");
  const scores = { T: 61, S: 22, H: 74, B: 18, A: 9, M: 40 };
  const p = buildNewgradPrompt({ typeName: "未使用", scores, marketValueScore: 77, salaryBand: "500万〜600万円", diagnosisVersion: NEWGRAD_VERSION });
  for (const leak of ["61", "74", "77", "500万", "市場価値スコア", "想定年収帯", "6才能スコア"]) assert.ok(!p.includes(leak), `渡してはいけない値: ${leak}`);
  for (const must of ["評価・断定しない", "年収・市場価値・順位", "実務経験や接客実績", "数値や点数は書かない", NEWGRAD_COMMON_NOTE]) assert.ok(p.includes(must), must);
  const top = calculateCoreType(scores).topType;
  assert.ok(p.includes(NEWGRAD_TYPE_CONTENT[top].headline) && p.includes(NEWGRAD_TYPE_CONTENT[top].writerNote));
});

test("旧15問: サーバー側で新しい保存を停止している（認証・DBに触れず拒否）。結果の表示ページは残っている", async () => {
  const { submitStudentDiagnosisAction } = await import("../lib/student-diagnosis/actions");
  const r = await submitStudentDiagnosisAction(Array(15).fill(0), "00000000-0000-4000-8000-000000000000");
  assert.equal(r.success, false);
  if (!r.success) { assert.equal(r.code, "closed"); assert.ok(r.message.includes("受付は終了")); }
  const src = readFileSync("lib/student-diagnosis/actions.ts", "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.ok(!/supabase|commitStudentDiagnosis|createClient|createServiceClient/.test(src), "保存・認証の処理を呼ばない");
  assert.ok(readFileSync("app/stylist/diagnosis/student/result/page.tsx", "utf8").length > 100, "保存済み結果の表示ページは残す");
});

test("入口を閉じた後に開いたままの画面から新卒が送られたとき: 専用の案内を出し、再送は促さない。画面がその案内を使っている", () => {
  const n = submissionErrorNotice("newgrad_disabled");
  assert.ok(n && n.retryable === false && n.message === NEWGRAD_CLOSED_MESSAGE);
  assert.match(NEWGRAD_CLOSED_MESSAGE, /受け付けていません/);
  assert.match(NEWGRAD_CLOSED_MESSAGE, /1問目/);
  for (const other of ["invalid_answers", "set_mismatch", "save_failed", undefined, null, 5]) assert.equal(submissionErrorNotice(other), null);
  // サーバーが実際にその拒否を返す（ログイン済み・ゲストの両経路）
  const v = verifySubmission("stylist", [4, ...Array(29).fill(0)], undefined, { newgradEnabled: false });
  assert.deepEqual(v.ok ? null : v.error, "newgrad_disabled");
  const src = readFileSync(new URL("../components/diagnosis/diagnosis-quiz.tsx", import.meta.url), "utf8");
  assert.equal((src.match(/submissionErrorNotice\(/g) ?? []).length, 2, "ログイン済み・ゲストの両方の送信で使う");
  assert.match(src, /errorCode !== "closed"/, "この案内では再送ボタンを出さない");
});
