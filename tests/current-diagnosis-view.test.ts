import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { decideDiagnosisView, decideMypageView, mypageSections, readCurrentDiagnosis, type CurrentDiagnosisRead } from "../lib/student-diagnosis/current";
import { fetchExperiencedForMypage, fetchStudentById, loadStudentResultForPage } from "../lib/student-diagnosis/current-results";
import { StudentCurrentCard } from "../components/student-diagnosis/student-current-card";
import { computeStudentResult } from "../lib/student-diagnosis/result";
import { STUDENT_QUESTIONS, STUDENT_DIAGNOSIS_VERSION, type StudentAnswers } from "../lib/student-diagnosis/questions";

const ok = (bank: "experienced" | "student" | null, id = "r1"): CurrentDiagnosisRead => ({ status: "ok", current: bank ? { bank, resultId: id, seq: 1 } : null });

const SEC = (v: "experienced" | "student" | "unknown" | "inconsistent") => mypageSections(v);
const ctx = (o: Partial<Parameters<typeof decideMypageView>[1]> = {}) => ({ experiencedRowId: null, experiencedFetchError: false, anyHistory: false, ...o });

test("マイページ: 現在が学生・新卒なら学生用だけ。経験者向け（才能グラフ・経験分析・AI解説）は出さない", () => {
  assert.equal(decideMypageView(ok("student", "s1"), ctx({ experiencedRowId: null, anyHistory: true })), "student");
  assert.deepEqual(SEC("student"), { showExperienced: false, showStudent: true, showUnknownNotice: false, showInconsistentNotice: false });
});
test("マイページ: 現在が経験者なら result_id と一致する結果だけ表示。0071未適用は従来表示。履歴なし・診断なしは従来の「診断を受ける」", () => {
  assert.equal(decideMypageView(ok("experienced", "e2"), ctx({ experiencedRowId: "e2", anyHistory: true })), "experienced");
  assert.equal(decideMypageView({ status: "unsupported" }, ctx({ experiencedRowId: "whatever" })), "experienced");
  assert.equal(decideMypageView(ok(null), ctx()), "experienced", "履歴も現在の診断も無い（まだ診断していない）");
});
test("マイページ: 現在の診断の行が無いのに履歴だけある／指す結果が無い → 不整合として案内。古い結果を現在として出さない", () => {
  assert.equal(decideMypageView(ok(null), ctx({ anyHistory: true })), "inconsistent");
  assert.equal(decideMypageView(ok("experienced", "e2"), ctx({ experiencedRowId: null, anyHistory: true })), "inconsistent", "現在のIDの結果が取れない");
  assert.equal(decideMypageView(ok("experienced", "e2"), ctx({ experiencedRowId: "e1" })), "inconsistent", "別の結果で代用しない");
  assert.deepEqual(SEC("inconsistent"), { showExperienced: false, showStudent: false, showUnknownNotice: false, showInconsistentNotice: true });
});
test("マイページ: 現在の診断を読めない・経験者結果の取得に失敗 → 読み込めませんでした（どの結果も出さない）", () => {
  assert.equal(decideDiagnosisView({ status: "error" }), "unknown");
  assert.equal(decideMypageView({ status: "error" }, ctx({ experiencedRowId: "e1", anyHistory: true })), "unknown");
  assert.equal(decideMypageView(ok("experienced", "e2"), ctx({ experiencedFetchError: true })), "unknown");
  assert.deepEqual(SEC("unknown"), { showExperienced: false, showStudent: false, showUnknownNotice: true, showInconsistentNotice: false });
});

// --- 取得は bank と result_id を基準にする（日時順の先頭で代用しない）。最小のインメモリ版のクライアントで、実際に発行されるクエリを検証する ---
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>, failTable?: string) {
  const log: string[] = [];
  const client = {
    from(t: string) {
      let rows = [...(tables[t] ?? [])]; const parts: string[] = []; const orders: { c: string; asc: boolean }[] = []; let lim = Infinity;
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); parts.push(`eq:${c}`); return b; },
        order: (c: string, o: { ascending: boolean }) => { orders.push({ c, asc: o.ascending }); parts.push(`order:${c}`); return b; },
        limit: (n: number) => { lim = n; return b; },
        maybeSingle: async () => { rows.sort((x, y) => { for (const { c, asc } of orders) { const d = String(x[c]) < String(y[c]) ? -1 : String(x[c]) > String(y[c]) ? 1 : 0; if (d) return d * (asc ? 1 : -1); } return 0; }); rows = rows.slice(0, lim); log.push(`${t}[${parts.join(",")}]`); return t === failTable ? { data: null, error: { code: "57014", message: "timeout" } } : { data: rows[0] ?? null, error: null }; },
      };
      return b;
    },
  };
  return { client: client as never, log };
}
const SAME = "2026-11-01T00:00:00Z";
// 同一日時の結果が複数、かつ id 順・保存順が日時順と食い違う
const expRows: Row[] = [
  { id: "e-b", user_id: "u", mode: "stylist", created_at: SAME },
  { id: "e-z", user_id: "u", mode: "stylist", created_at: SAME },
  { id: "e-a", user_id: "u", mode: "stylist", created_at: "2026-10-01T00:00:00Z" },
  { id: "other", user_id: "x", mode: "stylist", created_at: "2026-12-01T00:00:00Z" },
];
const stuRows: Row[] = [
  { id: "s-m", user_id: "u", answers: {}, version: "v", created_at: SAME },
  { id: "s-a", user_id: "u", answers: {}, version: "v", created_at: SAME },
  { id: "s-old", user_id: "u", answers: {}, version: "v", created_at: "2026-09-01T00:00:00Z" },
  { id: "s-other", user_id: "x", answers: {}, version: "v", created_at: "2026-12-01T00:00:00Z" },
];
const DB = () => fakeDb({ diagnosis_results: expRows, student_diagnosis_results: stuRows });

test("取得: 現在が経験者なら指定の result_id の経験者結果（日時順・保存順が違っても、同一日時が複数でも、指定IDそのもの）", async () => {
  for (const id of ["e-b", "e-z", "e-a"]) {
    const { client, log } = DB();
    const r = await fetchExperiencedForMypage(client, "u", ok("experienced", id));
    assert.equal(r.row?.id, id);
    assert.ok(log[0].includes("eq:id") && !log[0].includes("order"), "result_id 指定で取得し、日時順は使わない: " + log[0]);
  }
  const { client } = DB();
  assert.equal((await fetchExperiencedForMypage(client, "u", ok("experienced", "other"))).row, null, "他人の結果は指定しても取れない（本人のIDも指定）");
});
test("取得: 現在が学生なら経験者の結果は表示用に取らない（日時順の先頭で代用しない）。履歴の有無だけ見る", async () => {
  const { client } = DB();
  const r = await fetchExperiencedForMypage(client, "u", ok("student", "s-a"));
  assert.equal(r.row, null);
  assert.equal(r.historyExists, true);
});
test("取得: 0071未適用の従来表示だけが日時順の最新。読み取り失敗なら何も取らない", async () => {
  const { client, log } = DB();
  assert.ok((await fetchExperiencedForMypage(client, "u", { status: "unsupported" })).row);
  assert.ok(log[0].includes("order:created_at"));
  const none = fakeDb({ diagnosis_results: expRows });
  assert.deepEqual(await fetchExperiencedForMypage(none.client, "u", { status: "error" }), { row: null, error: false, historyExists: false });
  assert.equal(none.log.length, 0);
  const failing = fakeDb({ diagnosis_results: expRows }, "diagnosis_results");
  const f = await fetchExperiencedForMypage(failing.client, "u", ok("experienced", "e-a"));
  assert.equal(f.error, true);
  assert.equal(decideMypageView(ok("experienced", "e-a"), ctx({ experiencedFetchError: f.error })), "unknown");
});
test("学生結果ページ: 現在が学生なら指定の result_id（同一日時が複数・日時順の先頭ではない結果でも、指定IDを表示）", async () => {
  for (const id of ["s-m", "s-a", "s-old"]) {
    const { client, log } = DB();
    const r = await loadStudentResultForPage(client, "u", ok("student", id));
    assert.equal(r.kind, "current");
    assert.equal(r.kind === "current" && r.row.id, id);
    assert.ok(log[0].includes("eq:id") && !log[0].includes("order"));
  }
  const { client } = DB();
  assert.equal((await fetchStudentById(client, "u", "s-other")).row, null, "他人の学生結果は取れない");
});
test("学生結果ページ: 現在が経験者のときだけ、学生履歴から取得して「過去」。日時の新しい順・同一日時はID順の先頭", async () => {
  const { client } = DB();
  const r = await loadStudentResultForPage(client, "u", ok("experienced", "e-a"));
  assert.equal(r.kind, "past");
  assert.equal(r.kind === "past" && r.row.id, "s-m", "同一日時の中ではID降順で決まる（保存順に依存しない）");
});
test("学生結果ページ: 現在の診断の行が無く履歴だけある → 不整合（結果を出さない）／履歴も無い → 結果なし／指す結果が無い → 不整合／失敗・未適用", async () => {
  assert.equal((await loadStudentResultForPage(DB().client, "u", ok(null))).kind, "inconsistent");
  assert.equal((await loadStudentResultForPage(fakeDb({ student_diagnosis_results: [] }).client, "u", ok(null))).kind, "none");
  assert.equal((await loadStudentResultForPage(DB().client, "u", ok("student", "missing"))).kind, "inconsistent");
  assert.equal((await loadStudentResultForPage(DB().client, "u", { status: "error" })).kind, "error");
  assert.equal((await loadStudentResultForPage(DB().client, "u", { status: "unsupported" })).kind, "unavailable");
  assert.equal((await loadStudentResultForPage(fakeDb({ student_diagnosis_results: stuRows }, "student_diagnosis_results").client, "u", ok("student", "s-a"))).kind, "error");
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
test("画面の構造: 「いまの立場」は経験者向け表示の外／結果は bank・result_id 基準／学生の再診断は最下部の小さな導線／学生結果ページは過去を明示", () => {
  const my = readFileSync("app/stylist/mypage/page.tsx", "utf8");
  const iPhase = my.indexOf("<CareerPhaseSummary"), iExp = my.indexOf("sections.showExperienced &&");
  assert.ok(iPhase > 0 && iExp > iPhase, "いまの立場は経験者向けの分岐より前（分岐の外）");
  assert.ok(my.indexOf("<DiagnosisSummary") > iExp && my.indexOf("<CoreTypeHeader") > iExp, "経験者向けの部品は経験者のときだけの分岐の中");
  assert.ok(my.includes("await readCurrentDiagnosis(supabase, user.id)") && !my.includes('{ status: "unsupported" } as const'));
  assert.ok(my.includes("fetchExperiencedForMypage(") && my.includes("fetchStudentById(") && my.includes("decideMypageView("));
  assert.ok(!/from\("diagnosis_results"\)/.test(my), "マイページが直接、日時順で経験者の結果を取らない（取得は current-results 経由）");
  assert.ok(my.includes("現在の診断結果を読み込めませんでした") && my.includes("inconsistent-notice"));
  // 学生用の大きな再診断ボタンは無い。最下部の RetakeLink（回数制限の説明・無効化は RetakeLink が維持）
  const iBottom = my.lastIndexOf("<RetakeLink");
  assert.ok(iBottom > my.indexOf("プロフィール編集"), "再診断はページ最下部（プロフィール編集リンクより後）");
  assert.ok(my.includes('href="/stylist/diagnosis/student" hideBaseText'));
  assert.ok(!my.includes("学生・新卒の診断を受け直す"), "大きな再診断ボタンは廃止");
  const res = readFileSync("app/stylist/diagnosis/student/result/page.tsx", "utf8");
  assert.ok(res.includes("現在の結果ではありません") && res.includes('status === "past"') && res.includes("loadStudentResultForPage("));
  assert.ok(!res.includes('order("created_at"'), "結果ページが直接、日時順の先頭で取らない");
});
test("再診断の導線: 学生用も最下部の小さなリンク。回数制限の説明と無効化を維持", async () => {
  const { RetakeLink } = await import("../components/mypage/retake-link");
  const { parseRetakeLimit } = await import("../lib/diagnosis-limit/retake-status");
  const locked = renderToStaticMarkup(createElement(RetakeLink, { limit: parseRetakeLimit({ state: "locked", locked_until: "2027-02-01T00:00:00Z" }), href: "/stylist/diagnosis/student", hideBaseText: true, secondary: { href: "/stylist/diagnosis", label: "現役の美容師向けの診断を受ける" } }));
  assert.ok(locked.includes('aria-disabled="true"') && locked.includes("いまは変更できません") && !locked.includes('href="/stylist/diagnosis/student"'), "ロック中は無効化");
  assert.ok(locked.includes("3か月間変更できません") || locked.includes("計2回"), "回数制限の説明");
  const can = renderToStaticMarkup(createElement(RetakeLink, { limit: parseRetakeLimit({ state: "can_change" }), href: "/stylist/diagnosis/student", hideBaseText: true }));
  assert.ok(can.includes('href="/stylist/diagnosis/student"') && can.includes("text-[13px]") && !can.includes("rounded-full"), "小さなリンク（大きなボタンではない）");
  assert.ok(!can.includes("才能"));
});

test("読み取り失敗: 0071未適用と確認できた場合だけ従来表示。権限・JWT・通信・他の表の不在はすべて「読み込めませんでした」", async () => {
  const mk = (res: unknown) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => res }) }) }) }) as never;
  const throwing = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { throw new Error("fetch failed"); } }) }) }) } as never;
  const failures: unknown[] = [
    { data: null, error: { code: "42501", message: "permission denied for table stylist_diagnosis_current" } },
    { data: null, error: { code: "PGRST301", message: "JWT expired" } },
    { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } },
    { data: null, error: { code: "42P01", message: 'relation "some_other_table" does not exist' } },
    { data: null, error: { message: "TypeError: fetch failed" } },
  ];
  for (const f of failures) {
    const r = await readCurrentDiagnosis(mk(f), "u");
    assert.equal(r.status, "error", JSON.stringify(f));
    assert.equal(decideMypageView(r, ctx({ experiencedRowId: "old-experienced-id", anyHistory: true })), "unknown", "古い経験者結果を出さない");
  }
  assert.equal((await readCurrentDiagnosis(throwing, "u")).status, "error");
  const u = await readCurrentDiagnosis(mk({ data: null, error: { code: "42P01", message: 'relation "stylist_diagnosis_current" does not exist' } }), "u");
  assert.equal(decideMypageView(u, ctx({ experiencedRowId: "e1" })), "experienced");
});
