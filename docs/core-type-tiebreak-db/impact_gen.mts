/* eslint-disable @typescript-eslint/no-explicit-any */
// 経験者版: 丸め・同点の修正で、今後の判定が変わりうる回答を、実際の質問（Q）の回答から探す（乱数は固定シード）。
// 出力: <dir>/cases.csv（DBで旧/新を実行するための6軸）と <dir>/meta.json（添字→回答・変更前後のTS結果）。
import { Q } from "../../lib/diagnosis/questions.ts";
import { scoreTraits } from "../../lib/diagnosis/scoring.ts";
import { calculateCoreType, CORE_TYPE_CODES } from "../../lib/diagnosis/core-types.ts";
import { calculateCoreType as oldCalc } from "./old_core_types.snapshot.ts";
import { writeFileSync } from "node:fs";
const dir = process.argv[2]; const N = Number(process.argv[3] ?? 300000);
const K = ["T", "S", "H", "B", "A", "M"] as const;
let seed = 20261116; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const seen = new Map<string, { n: number; answers: number[]; s: Record<string, number> }>();
for (let i = 0; i < N; i++) {
  const a = Q.map((q) => Math.floor(rnd() * q.opts.length));
  const { traits } = scoreTraits(a, Q); const key = K.map((k) => traits[k]).join(",");
  const e = seen.get(key); if (e) e.n++; else seen.set(key, { n: 1, answers: a, s: traits });
}
const cases: string[] = []; const meta: Record<number, unknown> = {}; let i = 0; let rounding = 0, tie1 = 0, tie2 = 0, answersRounding = 0, answersTie = 0;
for (const [, v] of seen) {
  const nw = calculateCoreType(v.s as never), od = oldCalc(v.s as never);
  const t10 = CORE_TYPE_CODES.map((c) => Math.round(nw.matchScores[c] * 10)).sort((x, y) => y - x);
  const isTie1 = t10[0] === t10[1], isTie2 = !isTie1 && t10[1] === t10[2];
  const roundDiff = od.topType !== nw.topType || od.secondType !== nw.secondType || CORE_TYPE_CODES.some((c) => od.matchScores[c] !== nw.matchScores[c]);
  if (!(isTie1 || isTie2 || roundDiff)) continue;
  const tag = isTie1 ? "tie1" : isTie2 ? "tie2" : "round";
  if (roundDiff) { rounding++; answersRounding += v.n; }
  if (isTie1) tie1++; if (isTie2) tie2++; if (isTie1 || isTie2) answersTie += v.n;
  cases.push([i, tag, ...K.map((k) => v.s[k])].join(","));
  meta[i] = { tag, n: v.n, answers: v.answers, traits: v.s, tsOld: { top: od.topType, second: od.secondType, gap: od.scoreGap, scores: od.matchScores }, tsNew: { top: nw.topType, second: nw.secondType, gap: nw.scoreGap, scores: nw.matchScores } };
  i++;
}
writeFileSync(`${dir}/cases.csv`, cases.join("\n") + "\n");
writeFileSync(`${dir}/meta.json`, JSON.stringify({ N, distinct: seen.size, rounding, tie1, tie2, answersRounding, answersTie, cases: meta }));
console.log(JSON.stringify({ N, distinct: seen.size, cases: i, rounding, tie1, tie2, answersRounding, answersTie }));
