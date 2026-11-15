// DBが指す「現在の診断」と、アプリが画面に出す内容の一致を確認する（0071_current_view_gen.sh が書いたJSONを読む）。
// 画面の出し分けは、アプリ本体と同じ関数（lib/student-diagnosis/current.ts）で判定する。
import { readFileSync } from "node:fs";
import { decideMypageView, mypageSections, type CurrentDiagnosisRead } from "../../lib/student-diagnosis/current";
import { fetchExperiencedForMypage, loadStudentResultForPage } from "../../lib/student-diagnosis/current-results";

type Row = Record<string, unknown>;
type St = { current: { bank: "experienced" | "student"; result_id: string; seq: number } | null; latest_experienced_id: string | null; latest_student_id: string | null; experienced_rows: Row[]; student_rows: Row[]; experienced_count: number; student_count: number; change_count: number | null };
const steps: { step: string; outcome: string; state: St }[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
let fail = 0, pass = 0;
const chk = (name: string, ok: boolean, info = "") => { if (ok) { pass++; console.log(`PASS  ${name}`); } else { fail++; console.log(`FAIL  ${name} ${info}`); } };
const read = (s: St): CurrentDiagnosisRead => ({ status: "ok", current: s.current ? { bank: s.current.bank, resultId: s.current.result_id, seq: s.current.seq } : null });
const by = (n: number) => steps[n - 1];

// DBから取り出した実際の行（ID・日時）に対して、アプリが発行するクエリを実行する最小のクライアント（eq / order / limit / maybeSingle）
function fakeDb(tables: Record<string, Row[]>) {
  return { from(t: string) {
    let rows = [...(tables[t] ?? [])]; const orders: { c: string; asc: boolean }[] = []; let lim = Infinity;
    const b = {
      select: () => b, eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return b; },
      order: (c: string, o: { ascending: boolean }) => { orders.push({ c, asc: o.ascending }); return b; }, limit: (n: number) => { lim = n; return b; },
      maybeSingle: async () => { rows.sort((x, y) => { for (const { c, asc } of orders) { const d = String(x[c]) < String(y[c]) ? -1 : String(x[c]) > String(y[c]) ? 1 : 0; if (d) return d * (asc ? 1 : -1); } return 0; }); return { data: rows.slice(0, lim)[0] ?? null, error: null }; },
    };
    return b;
  } } as never;
}

async function main() {
  // 期待: ステップごとの (処理結果, DBが指す現在の診断のバンク)
  const expect: [number, string, "experienced" | "student"][] = [
    [1, "initial", "experienced"], [2, "change", "student"], [3, "diagnosis_change_locked", "student"], [4, "change", "student"],
    [5, "unchanged", "student"], [6, "change", "experienced"], [7, "change", "experienced"], [8, "change", "student"], [9, "unchanged", "student"],
  ];
  for (const [n, outcome, bank] of expect) {
    const { step, state, outcome: o } = by(n);
    chk(`${step}: 処理結果=${outcome}`, o === outcome, `実際: ${o}`);
    chk(`${step}: DBが指す現在の診断=${bank}`, state.current?.bank === bank, JSON.stringify(state.current));
    const db = fakeDb({ diagnosis_results: state.experienced_rows, student_diagnosis_results: state.student_rows });
    const rd = read(state);
    const uid = (state.experienced_rows[0]?.user_id ?? state.student_rows[0]?.user_id) as string;
    const exp = await fetchExperiencedForMypage(db, uid, rd);
    const page = await loadStudentResultForPage(db, uid, rd);
    const view = decideMypageView(rd, { experiencedRowId: (exp.row as Row | null)?.id as string ?? null, experiencedFetchError: exp.error, anyHistory: exp.historyExists || state.student_rows.length > 0 });
    const sec = mypageSections(view);
    if (bank === "student") {
      chk(`${step}: マイページは学生用だけ（経験者向けは出さない）`, sec.showStudent && !sec.showExperienced && !sec.showUnknownNotice && !sec.showInconsistentNotice && exp.row === null);
      chk(`${step}: 学生結果ページが出す結果＝DBの現在の結果（result_id）で「現在の結果」`, page.kind === "current" && (page.row.id as string) === state.current!.result_id, JSON.stringify(page.kind));
    } else {
      chk(`${step}: マイページは従来の経験者向け表示（学生用は出さない）`, sec.showExperienced && !sec.showStudent);
      chk(`${step}: マイページが出す経験者の結果＝DBの現在の結果（result_id）`, (exp.row as Row | null)?.id === state.current!.result_id);
      if (state.student_rows.length) chk(`${step}: 学生結果ページは学生履歴から取得し「過去の結果」と明示される`, page.kind === "past");
    }
  }
  // 現在の診断の行が無いのに履歴だけある場合は、古い結果を現在として出さず不整合
  const s9 = by(9).state; const uid = (s9.experienced_rows[0]?.user_id) as string;
  const orphanRead: CurrentDiagnosisRead = { status: "ok", current: null };
  const dbAll = fakeDb({ diagnosis_results: s9.experienced_rows, student_diagnosis_results: s9.student_rows });
  const ex = await fetchExperiencedForMypage(dbAll, uid, orphanRead);
  chk("現在の診断の行なし＋履歴あり: マイページは不整合の案内（結果を出さない）", decideMypageView(orphanRead, { experiencedRowId: null, experiencedFetchError: false, anyHistory: ex.historyExists }) === "inconsistent" && ex.row === null);
  chk("現在の診断の行なし＋履歴あり: 学生結果ページも不整合（結果を出さない）", (await loadStudentResultForPage(dbAll, uid, orphanRead)).kind === "inconsistent");
  // 同一日時の結果が複数ある場合: 指定されたIDの結果が出る（日時順・ID順の先頭ではなく）
  const ts = "2026-11-01T00:00:00Z";
  const dup = (id: string): Row => ({ id, user_id: uid, mode: "stylist", created_at: ts });
  const dupS = (id: string): Row => ({ id, user_id: uid, answers: {}, version: "v", created_at: ts });
  const dbDup = fakeDb({ diagnosis_results: [dup("m"), dup("z"), dup("a")], student_diagnosis_results: [dupS("m"), dupS("z"), dupS("a")] });
  for (const id of ["m", "z", "a"]) {
    chk(`同一日時の複数結果: 現在の経験者結果=${id} が指定どおり出る`, ((await fetchExperiencedForMypage(dbDup, uid, { status: "ok", current: { bank: "experienced", resultId: id, seq: 1 } })).row as Row | null)?.id === id);
    const p = await loadStudentResultForPage(dbDup, uid, { status: "ok", current: { bank: "student", resultId: id, seq: 1 } });
    chk(`同一日時の複数結果: 現在の学生結果=${id} が指定どおり出る`, p.kind === "current" && (p.row.id as string) === id);
  }
// 件数・回数の整合（診断の計算・回数制限は変えていない）
chk("拒否(3)・同じ送信ID(4,7)・同じ回答(5,9)では結果が増えない", by(3).state.experienced_count === by(2).state.experienced_count && by(3).state.student_count === by(2).state.student_count
  && by(4).state.student_count === by(2).state.student_count && by(5).state.student_count === by(2).state.student_count && by(7).state.experienced_count === by(6).state.experienced_count && by(9).state.student_count === by(8).state.student_count);
chk("変更回数: 2・6・8 で1ずつ増え、拒否・再送・変更なしでは増えない", [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => by(n).state.change_count).join(",") === "0,1,1,1,1,2,2,3,3", [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => by(n).state.change_count).join(","));
chk("現在の診断の連番は保存成功のときだけ増える（拒否・再送・変更なしで不変）", [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => by(n).state.current?.seq).join(",") === "1,2,2,2,2,3,3,4,4");
chk("切替後も過去の結果は残る（経験者・学生の結果とも削除されない）", by(9).state.experienced_count === 2 && by(9).state.student_count === 2);
chk("0071未適用（表なし）は従来の経験者向け表示", mypageSections(decideMypageView({ status: "unsupported" }, { experiencedRowId: null, experiencedFetchError: false, anyHistory: false })).showExperienced);
  console.log(`-- 結果: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}
main();

