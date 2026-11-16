/* eslint-disable @typescript-eslint/no-explicit-any */
// DB（0078適用後）の保存結果を、アプリの自動テスト用の固定データ（tests/fixtures/core-type-db-parity.csv）に書き出す。
// 使い方: npx tsx docs/core-type-tiebreak-db/export_fixture.mts <出力csv> <gen_casesの作業dir> <impact_genの作業dir>
// 各dirには results_new.csv（DB保存結果）が必要。件数は種類ごとに上限をかけて、ファイルを小さく保つ。
import { readFileSync, writeFileSync } from "node:fs";
import { CORE_TYPE_CODES } from "../../lib/diagnosis/core-types.ts";
const [out, genDir, impDir] = process.argv.slice(2);
const K = ["T", "S", "H", "B", "A", "M"];
const rows: string[] = ["src,tag,T,S,H,B,A,M,top,second,gap10," + CORE_TYPE_CODES.map((_, i) => "m" + i).join(",")];
const db = (dir: string) => new Map(readFileSync(`${dir}/results_new.csv`, "utf8").trim().split("\n").map((l) => { const [i, t, s, g, ms] = l.split("|"); return [Number(i), { t, s, g, ms: JSON.parse(ms) as Record<string, number> }] as const; }));
function emit(src: string, tag: string, traits: number[], r: { t: string; s: string; g: string; ms: Record<string, number> }) {
  rows.push([src, tag, ...traits, r.t, r.s, Math.round(Number(r.g) * 10), ...CORE_TYPE_CODES.map((c) => Math.round(Number(r.ms[c]) * 10))].join(","));
}
{ const res = db(genDir); const cap: Record<string, number> = { tie1: 700, tie2: 700, bnd: 700, near: 500, special: 99, rand: 300, grid: 300 }; const got: Record<string, number> = {};
  for (const l of readFileSync(`${genDir}/cases.csv`, "utf8").trim().split("\n")) { const p = l.split(","); const tag = p[1]; if ((got[tag] ?? 0) >= (cap[tag] ?? 0)) continue; got[tag] = (got[tag] ?? 0) + 1; emit("gen", tag, p.slice(2, 8).map(Number), res.get(Number(p[0]))!); } }
{ const res = db(impDir); const meta = JSON.parse(readFileSync(`${impDir}/meta.json`, "utf8")); const cap = 700; const got: Record<string, number> = {};
  for (const [i, m] of Object.entries<any>(meta.cases)) { if ((got[m.tag] ?? 0) >= cap) continue; got[m.tag] = (got[m.tag] ?? 0) + 1; emit("exp", m.tag, K.map((k) => m.traits[k]), res.get(Number(i))!); } }
writeFileSync(out, rows.join("\n") + "\n"); console.log("rows:", rows.length - 1);
