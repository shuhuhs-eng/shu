/* eslint-disable @typescript-eslint/no-explicit-any */
// 設計JSON（GPT作成・正本）と、実装した Q_NEWGRAD／既存 Q／設計メモの表・検証JSONを突き合わせ、食い違いを具体的に出す。
// 質問・配点・説明文は、テストに合わせて変えない。使い方: npx tsx docs/student-newgrad-30/reconcile.mts
import fs from "node:fs";
import { Q } from "../../lib/diagnosis/questions.ts";
import { Q_NEWGRAD } from "../../lib/diagnosis/newgrad-questions.ts";
import { scoreTraits } from "../../lib/diagnosis/scoring.ts";
import { calculateCoreType } from "../../lib/diagnosis/core-types.ts";

const S = "docs/student-newgrad-30/source/";
const d = JSON.parse(fs.readFileSync(S + "newgrad30_scoring_design.json", "utf8"));
const v = JSON.parse(fs.readFileSync(S + "design_verification.json", "utf8"));
const md = fs.readFileSync(S + "newgrad30_design_review.md", "utf8");
const T = d.axes as string[];
const out: string[] = [];
const say = (s: string) => out.push(s);
let issues = 0;
const issue = (s: string) => { issues++; say("【食い違い】" + s); };

say("# 設計JSONと実装・既存Q・設計メモの突き合わせ");
// 1) 構造
say(`\n## 1. 構造\n- 問数 ${d.questions.length}（実装 ${Q_NEWGRAD.length}）。採点対象 ${d.questions.filter((q: any) => q.counted).length}問。`);
if (d.questions.length !== 30 || Q_NEWGRAD.length !== 30) issue("問数が30でない");
d.questions.forEach((q: any, i: number) => {
  const e = Q_NEWGRAD[i];
  if (e.q !== q.question) issue(`質問文 ${q.id}`);
  if (e.opts.length !== q.options.length) issue(`選択肢数 ${q.id}`);
  q.options.forEach((o: any, j: number) => {
    if (e.opts[j].t !== o.text) issue(`選択肢文 ${q.id}[${j}]`);
    if (JSON.stringify(e.opts[j].w) !== JSON.stringify(o.weights)) issue(`配点 ${q.id}[${j}]`);
  });
});
if (!out.some((l) => l.startsWith("【食い違い】"))) say("- 実装(Q_NEWGRAD)は設計JSONと、質問文・選択肢文・配点がすべて一致。");

// 2) 1問目・3問目の除外
for (const id of ["p1", "p3"]) {
  const q = d.questions.find((x: any) => x.id === id);
  const allEmpty = q.options.every((o: any) => Object.keys(o.weights).length === 0);
  say(`- ${id}: counted=${q.counted} / 全選択肢の配点が空=${allEmpty}（分子・分母とも0）`);
  if (q.counted || !allEmpty) issue(`${id} が除外されていない`);
}

// 3) 各問の加点総和・非負・question_weight
say("\n## 2. 各問の加点総和（設計は「各問の選択肢加点総量が同じ」としている）\n- 注: JSONの question_weight は加点総和の半分（通常1＝総和2、希望項目0.5＝総和1）。採点には使われず、表記上の相対値。値の不一致ではないため食い違いには数えない。");
const sums: Record<string, number[]> = {};
d.questions.filter((q: any) => q.counted).forEach((q: any) => {
  const s = q.options.map((o: any) => Object.values(o.weights).reduce((a: number, b: any) => a + b, 0));
  sums[q.id] = s;
  if (new Set(s).size !== 1) issue(`${q.id}: 選択肢ごとの加点総和が揃っていない ${JSON.stringify(s)}`);
  if (q.options.some((o: any) => Object.values(o.weights).some((x: any) => x < 0))) issue(`${q.id}: 負の加点`);
  if (s[0] !== q.question_weight * 2) issue(`${q.id}: question_weight=${q.question_weight} と加点総和=${s[0]} の関係が「総和＝question_weight×2」でない`);
});
const w1 = Object.entries(sums).filter(([, s]) => s[0] === 1).map(([k]) => k).join(",");
say(`- 加点総和1の問: ${w1}`);
const memo1 = [4,5,9,13,16,17,19,21,27,29,30].map((n) => d.questions[n - 1].id).join(",");
say(`- 設計メモが「合計1点」とする問(番号4,5,9,13,16,17,19,21,27,29,30): ${memo1}`);
if (w1.split(",").sort().join() !== memo1.split(",").sort().join()) issue(`加点総和1の問がメモ記載と一致しない（JSON: ${w1} / メモ: ${memo1}）`);

// 4) 設計メモの配点表 vs JSON
say("\n## 3. 設計メモの配点対応表 vs JSON");
const rows = [...md.matchAll(/^\|(\d+)・(\w+)\|[^|]*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|$/gm)];
say(`- メモの表の行数: ${rows.length}（採点28問のはず）`);
const parseCell = (c: string) => { const w: Record<string, number> = {}; for (const m of c.trim().matchAll(/([TSHBAM])(\d+(?:\.\d+)?)/g)) w[m[1]] = (w[m[1]] ?? 0) + Number(m[2]); return w; };
let memoBad = 0;
for (const r of rows) {
  const q = d.questions[Number(r[1]) - 1];
  if (q.id !== r[2]) { issue(`メモの表: 番号${r[1]}のIDが ${r[2]}（JSONは ${q.id}）`); memoBad++; continue; }
  [3, 4, 5, 6].forEach((c, j) => {
    const a = parseCell(r[c]); const b = q.options[j].weights;
    if (JSON.stringify(Object.entries(a).sort()) !== JSON.stringify(Object.entries(b).sort())) { issue(`メモの表と配点が違う ${q.id}[${j}] メモ=${r[c].trim()} JSON=${JSON.stringify(b)}`); memoBad++; }
  });
}
if (!memoBad) say("- 表とJSONは全セル一致。");

// 5) 分母
const den: Record<string, number> = Object.fromEntries(T.map((t) => [t, 0]));
for (const q of d.questions.filter((x: any) => x.counted)) for (const t of T) den[t] += Math.max(...q.options.map((o: any) => o.weights[t] ?? 0));
say(`\n## 4. 軸別の分母（各問の最大点の合計）\n- 実測 ${JSON.stringify(den)}\n- 検証JSON ${JSON.stringify(v.simulation.denominators)}`);
if (JSON.stringify(den) !== JSON.stringify(v.simulation.denominators)) issue("分母が検証JSONと違う");

// 6) 到達例を、実装の採点＋タイプ決定で再計算
say("\n## 5. 検証JSONの到達例（各タイプ）を、実装の関数で再計算");
for (const [type, w] of Object.entries<any>(v.witnesses)) {
  const { traits } = scoreTraits(w.answers, Q_NEWGRAD);
  const c = calculateCoreType(traits);
  const sameScores = JSON.stringify(traits) === JSON.stringify(w.scores);
  const sameMatch = Object.entries(w.match_scores).every(([k, x]) => (c.matchScores as any)[k] === x);
  const ok = c.topType === type && sameScores && sameMatch && Math.abs(c.scoreGap - w.gap) < 1e-9;
  say(`- ${type}: 実装の1位=${c.topType} 軸=${sameScores ? "一致" : "不一致"} 8タイプ得点=${sameMatch ? "一致" : "不一致"} 差=${c.scoreGap}(検証JSON ${w.gap}) → ${ok ? "OK" : "NG"}`);
  if (!ok) issue(`到達例 ${type} が再現しない: 実装 top=${c.topType} traits=${JSON.stringify(traits)} / JSON traits=${JSON.stringify(w.scores)}`);
}

// 7) 合成回答の分布（乱数は検証JSONと別実装のため、件数は一致しない。傾向の目安）
let seed = 20261116; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const N = 100000; const counts: Record<string, number> = {}; let ties = 0, le2 = 0;
for (let n = 0; n < N; n++) {
  const a = Q_NEWGRAD.map((q, i) => (i === 0 ? 4 : i === 2 ? Math.floor(rnd() * 5) : Math.floor(rnd() * 4)));
  const c = calculateCoreType(scoreTraits(a, Q_NEWGRAD).traits);
  counts[c.topType] = (counts[c.topType] ?? 0) + 1; if (c.scoreGap === 0) ties++; if (c.scoreGap <= 2) le2++;
}
say(`\n## 6. 合成回答${N}件（各問一様。別乱数のため検証JSONの件数とは一致しない）\n- 1位の内訳 ${JSON.stringify(counts)}\n- 首位同点 ${(ties / N * 100).toFixed(2)}% / 差2.0以内 ${(le2 / N * 100).toFixed(1)}%（検証JSON: ${(v.simulation.exact_ties / v.simulation.N * 100).toFixed(2)}% / ${(v.simulation.gap_le_2 / v.simulation.N * 100).toFixed(1)}%）`);

// 8) 既存Qとの比較（参考）
say("\n## 7. 既存の経験者版Qとの違い（新卒版の質問は書き換えられている。経験者版Qは変更しない）");
const diffs: string[] = [];
Q_NEWGRAD.forEach((q, i) => { if (q.q !== Q[i].q) diffs.push(`${Q[i].id}: 「${Q[i].q}」→「${q.q}」`); });
say(`- 質問文が異なる問: ${diffs.length}/30`); diffs.slice(0, 5).forEach((x) => say("  - " + x)); say("  - …（全件はこの出力の末尾の一覧）");
const p1same = [0, 1, 2, 3].every((j) => Q_NEWGRAD[0].opts[j].t === Q[0].opts[j].t);
say(`- 1問目の選択肢0〜3の文言は既存と同じ: ${p1same}（5つ目「${Q_NEWGRAD[0].opts[4].t}」が新規）`);
if (!p1same) issue("1問目の既存選択肢の文言が既存Qと違う（保存済みの添字の意味が変わる）");
say(`- 1問目の質問文: 既存「${Q[0].q}」／共通入口「${Q_NEWGRAD[0].q}」（共通入口の文言は設計JSONを採用。経験者の回答の添字0〜3は変わらない）`);
say("\n### 質問文が異なる問の全件"); diffs.forEach((x) => say("- " + x));
say(`\n## 結論\n- 食い違い件数: ${issues}`);
fs.writeFileSync("docs/student-newgrad-30/reconcile_result.md", out.join("\n") + "\n");
console.log(out.join("\n")); process.exit(issues ? 1 : 0);
