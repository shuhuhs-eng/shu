// DBが指す「現在の診断」と、アプリが画面に出す内容の一致を確認する（0071_current_view_gen.sh が書いたJSONを読む）。
// 画面の出し分けは、アプリ本体と同じ関数（lib/student-diagnosis/current.ts）で判定する。
import { readFileSync } from "node:fs";
import { decideDiagnosisView, decideStudentResultStatus, mypageSections, type CurrentDiagnosisRead } from "../../lib/student-diagnosis/current";

type St = { current: { bank: "experienced" | "student"; result_id: string; seq: number } | null; latest_experienced_id: string | null; latest_student_id: string | null; experienced_count: number; student_count: number; change_count: number | null };
const steps: { step: string; outcome: string; state: St }[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
let fail = 0, pass = 0;
const chk = (name: string, ok: boolean, info = "") => { if (ok) { pass++; console.log(`PASS  ${name}`); } else { fail++; console.log(`FAIL  ${name} ${info}`); } };
const read = (s: St): CurrentDiagnosisRead => ({ status: "ok", current: s.current ? { bank: s.current.bank, resultId: s.current.result_id, seq: s.current.seq } : null });
const by = (n: number) => steps[n - 1];

// 期待: ステップごとの (処理結果, DBが指す現在の診断のバンク, 現在の結果がどちらの最新か)
const expect: [number, string, "experienced" | "student"][] = [
  [1, "initial", "experienced"], [2, "change", "student"], [3, "diagnosis_change_locked", "student"], [4, "change", "student"],
  [5, "unchanged", "student"], [6, "change", "experienced"], [7, "change", "experienced"], [8, "change", "student"], [9, "unchanged", "student"],
];
for (const [n, outcome, bank] of expect) {
  const { step, state, outcome: o } = by(n);
  chk(`${step}: 処理結果=${outcome}`, o === outcome, `実際: ${o}`);
  chk(`${step}: DBが指す現在の診断=${bank}`, state.current?.bank === bank, JSON.stringify(state.current));
  const view = decideDiagnosisView(read(state));
  const sec = mypageSections(view);
  if (bank === "student") {
    chk(`${step}: マイページは学生用だけ（経験者向けは出さない）`, sec.showStudent && !sec.showExperienced && !sec.showUnknownNotice);
    chk(`${step}: マイページが出す学生の結果＝DBの現在の結果（最新の学生結果）`, state.current!.result_id === state.latest_student_id);
    chk(`${step}: 学生結果ページは「現在の結果」`, decideStudentResultStatus(read(state), String(state.latest_student_id)) === "current");
  } else {
    chk(`${step}: マイページは従来の経験者向け表示（学生用は出さない）`, sec.showExperienced && !sec.showStudent);
    chk(`${step}: マイページが出す経験者の結果＝DBの現在の結果（最新の経験者結果）`, state.current!.result_id === state.latest_experienced_id);
    if (state.latest_student_id) chk(`${step}: 学生結果ページは「過去の結果」と明示される`, decideStudentResultStatus(read(state), String(state.latest_student_id)) === "past");
  }
}
// 件数・回数の整合（診断の計算・回数制限は変えていない）
chk("拒否(3)・同じ送信ID(4,7)・同じ回答(5,9)では結果が増えない", by(3).state.experienced_count === by(2).state.experienced_count && by(3).state.student_count === by(2).state.student_count
  && by(4).state.student_count === by(2).state.student_count && by(5).state.student_count === by(2).state.student_count && by(7).state.experienced_count === by(6).state.experienced_count && by(9).state.student_count === by(8).state.student_count);
chk("変更回数: 2・6・8 で1ずつ増え、拒否・再送・変更なしでは増えない", [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => by(n).state.change_count).join(",") === "0,1,1,1,1,2,2,3,3", [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => by(n).state.change_count).join(","));
chk("現在の診断の連番は保存成功のときだけ増える（拒否・再送・変更なしで不変）", [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => by(n).state.current?.seq).join(",") === "1,2,2,2,2,3,3,4,4");
chk("切替後も過去の結果は残る（経験者・学生の結果とも削除されない）", by(9).state.experienced_count === 2 && by(9).state.student_count === 2);
chk("0071未適用（表なし）は従来の経験者向け表示", mypageSections(decideDiagnosisView({ status: "unsupported" })).showExperienced);
console.log(`-- 結果: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
