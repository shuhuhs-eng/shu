// 0078 検証用: DBの保存結果（results_*.csv）と、アプリの calculateCoreType の結果を突き合わせる。
import { calculateCoreType, CORE_TYPE_CODES } from "../../lib/diagnosis/core-types.ts";
import { readFileSync } from "node:fs";
const dir = process.argv[2], phase = process.argv[3];
const K = ["T", "S", "H", "B", "A", "M"] as const;
const cases = new Map(readFileSync(`${dir}/cases.csv`, "utf8").trim().split("\n").map((l) => { const p = l.split(","); return [Number(p[0]), { tag: p[1], s: Object.fromEntries(K.map((k, j) => [k, Number(p[2 + j])])) as Record<(typeof K)[number], number> }] as const; }));
const by: Record<string, { n: number; top: number; second: number; gap: number; scores: number }> = {};
let total = 0, bad = 0; const ex: string[] = [];
for (const line of readFileSync(`${dir}/results_${phase}.csv`, "utf8").trim().split("\n")) {
  const [iS, top, second, gap, ms] = line.split("|"); const c = cases.get(Number(iS))!; const ts = calculateCoreType(c.s);
  const sql = JSON.parse(ms) as Record<string, number>;
  const b = (by[c.tag] ??= { n: 0, top: 0, second: 0, gap: 0, scores: 0 }); b.n++; total++;
  const eTop = top !== ts.topType, eSec = second !== ts.secondType, eGap = Math.abs(Number(gap) - ts.scoreGap) > 1e-9;
  const eSc = CORE_TYPE_CODES.some((code) => Math.abs(Number(sql[code]) - ts.matchScores[code]) > 1e-9);
  if (eTop) b.top++; if (eSec) b.second++; if (eGap) b.gap++; if (eSc) b.scores++;
  if ((eTop || eSec || eGap || eSc) && ex.length < 3) ex.push(`case ${iS} ${c.tag} ${JSON.stringify(c.s)} DB=${top}/${second}/${gap} TS=${ts.topType}/${ts.secondType}/${ts.scoreGap}`);
  if (eTop || eSec || eGap || eSc) bad++;
}
console.log(`[${phase}] 件数 ${total} / 食い違い（1位・2位・差・8タイプの得点のいずれか）${bad}`);
for (const [t, b] of Object.entries(by)) console.log(`  ${t.padEnd(8)} n=${String(b.n).padStart(6)}  1位違い=${b.top}  2位違い=${b.second}  差違い=${b.gap}  得点違い=${b.scores}`);
for (const e of ex) console.log("  例:", e);
process.exit(phase === "new" ? (bad === 0 ? 0 : 1) : 0);
