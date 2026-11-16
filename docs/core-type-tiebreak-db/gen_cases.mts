// 0078 検証用: 6才能スコアのケースを作る（ローカル検証専用。乱数は固定シード）。
// 出力: <dir>/cases.csv（i,tag,T,S,H,B,A,M）。種類: grid=0/25/50/75/100の全組合せ（15,625通り）、rand=乱数、
//   tie1=8タイプの1位が同点、tie2=1位は単独で2位が同点、bnd=0.05刻みの丸め境界を含む、near=1位と2位が0.1差、special=全0・全100 など。
import { calculateCoreType, CORE_TYPE_CODES, CORE_TYPE_WEIGHTS } from "../../lib/diagnosis/core-types.ts";
import { writeFileSync } from "node:fs";
const K = ["T", "S", "H", "B", "A", "M"] as const;
type S = Record<(typeof K)[number], number>;
let seed = 20261116; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const vec = (): S => Object.fromEntries(K.map((k) => [k, Math.floor(rnd() * 101)])) as S;
const rows: { tag: string; s: S }[] = [];
const g = [0, 25, 50, 75, 100];
for (const a of g) for (const b of g) for (const c of g) for (const d of g) for (const e of g) for (const f of g) rows.push({ tag: "grid", s: { T: a, S: b, H: c, B: d, A: e, M: f } });
for (let n = 0; n < 4000; n++) rows.push({ tag: "rand", s: vec() });
const want: Record<string, number> = { tie1: 3000, tie2: 2000, bnd: 3000, near: 2000 };
const got: Record<string, number> = { tie1: 0, tie2: 0, bnd: 0, near: 0 };
const hund = (s: S, code: (typeof CORE_TYPE_CODES)[number]) => K.reduce((x, k) => x + Math.round(CORE_TYPE_WEIGHTS[code][k] * 100) * s[k], 0);
let guard = 0;
while (Object.keys(want).some((t) => got[t] < want[t]) && guard++ < 3_000_000) {
  const s = vec(); const ct = calculateCoreType(s); const t10 = CORE_TYPE_CODES.map((c) => Math.round(ct.matchScores[c] * 10)).sort((x, y) => y - x);
  const tags: string[] = [];
  if (t10[0] === t10[1]) tags.push("tie1"); else if (t10[1] === t10[2]) tags.push("tie2");
  if (CORE_TYPE_CODES.some((c) => hund(s, c) % 10 === 5)) tags.push("bnd");
  if (t10[0] - t10[1] === 1) tags.push("near");
  for (const t of tags) if (got[t] < want[t]) { got[t]++; rows.push({ tag: t, s }); break; }
}
for (const v of [0, 100, 50, 1, 99]) rows.push({ tag: "special", s: { T: v, S: v, H: v, B: v, A: v, M: v } });
for (const k of K) { const s = { T: 0, S: 0, H: 0, B: 0, A: 0, M: 0 } as S; s[k] = 100; rows.push({ tag: "special", s }); }
const dir = process.argv[2];
writeFileSync(`${dir}/cases.csv`, rows.map((r, i) => [i, r.tag, ...K.map((k) => r.s[k])].join(",")).join("\n") + "\n");
console.log("cases:", rows.length, JSON.stringify(got));
