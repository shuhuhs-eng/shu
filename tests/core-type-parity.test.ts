import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateCoreType, CORE_TYPE_CODES, CORE_TYPE_WEIGHTS, type CoreTypeCode } from "../lib/diagnosis/core-types";

/**
 * 8タイプ判定の同点・僅差・丸め境界。アプリ（calculateCoreType）と、DBの save_core_type_result（0078適用後）の
 * 1位・2位・差・8タイプの得点が一致することを確認する。
 *  ・DBの値は、ローカルの使い捨てDBで 0078 を適用して実行した結果を固定データにしたもの（tests/fixtures/core-type-db-parity.csv）。
 *    再生成: bash docs/core-type-tiebreak-db/run_0078_verify.sh（本番には接続しない）。
 *  ・既存の413件のテストとは別に、同点・僅差・丸め境界を専用に確認する。
 */
const K = ["T", "S", "H", "B", "A", "M"] as const;
type S = Record<(typeof K)[number], number>;
const s6 = (T: number, S_: number, H: number, B: number, A: number, M: number): S => ({ T, S: S_, H, B, A, M });

// 独立した参照実装: 整数（1/100単位）で厳密に計算し、定義順で並べる（アプリ本体とは別に書いた規則）。
function reference(s: S) {
  const tenths = CORE_TYPE_CODES.map((c, order) => {
    const h = K.reduce((x, k) => x + Math.round(CORE_TYPE_WEIGHTS[c][k] * 100) * s[k], 0); // 重み×100 の整数 × 点数
    return { c, order, t: Math.floor((h + 5) / 10) }; // 小数第1位へ四捨五入（正数）
  });
  tenths.sort((a, b) => b.t - a.t || a.order - b.order);
  return { top: tenths[0].c, second: tenths[1].c, gap10: tenths[0].t - tenths[1].t, all: Object.fromEntries(tenths.map((x) => [x.c, x.t])) as Record<CoreTypeCode, number> };
}

test("DB（0078適用後）との一致: 固定データの全行で、1位・2位・差・8タイプの得点が一致する", () => {
  const lines = readFileSync("tests/fixtures/core-type-db-parity.csv", "utf8").trim().split("\n");
  const head = lines[0].split(",");
  assert.deepEqual(head.slice(0, 11), ["src", "tag", "T", "S", "H", "B", "A", "M", "top", "second", "gap10"]);
  const tags = new Map<string, number>();
  let bad = 0;
  for (const line of lines.slice(1)) {
    const p = line.split(",");
    const s = s6(...(p.slice(2, 8).map(Number) as [number, number, number, number, number, number]));
    const r = calculateCoreType(s);
    const ok = r.topType === p[8] && r.secondType === p[9] && Math.round(r.scoreGap * 10) === Number(p[10]) && CORE_TYPE_CODES.every((c, i) => Math.round(r.matchScores[c] * 10) === Number(p[11 + i]));
    if (!ok) { bad++; if (bad <= 3) assert.fail(`不一致 ${line} → アプリ ${r.topType}/${r.secondType}/${r.scoreGap}`); }
    tags.set(`${p[0]}:${p[1]}`, (tags.get(`${p[0]}:${p[1]}`) ?? 0) + 1);
  }
  assert.equal(bad, 0);
  // 固定データが、同点・僅差・丸め境界・特殊値をすべて含んでいること（空の確認にならないように件数も見る）
  for (const need of ["gen:tie1", "gen:tie2", "gen:bnd", "gen:near", "gen:special", "exp:tie1", "exp:tie2", "exp:round"]) assert.ok((tags.get(need) ?? 0) >= 10, `${need} の件数`);
  assert.ok(lines.length - 1 >= 5000, `行数 ${lines.length - 1}`);
});

test("参照実装との一致（厳密な整数計算）: 格子15,625通り＋乱数20,000通りで、1位・2位・差・8タイプの得点が一致する", () => {
  let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const cases: S[] = [];
  const g = [0, 25, 50, 75, 100];
  for (const a of g) for (const b of g) for (const c of g) for (const d of g) for (const e of g) for (const f of g) cases.push(s6(a, b, c, d, e, f));
  for (let i = 0; i < 20000; i++) cases.push(s6(...(Array.from({ length: 6 }, () => Math.floor(rnd() * 101)) as [number, number, number, number, number, number])));
  for (const s of cases) {
    const r = calculateCoreType(s), ref = reference(s);
    assert.equal(r.topType, ref.top, JSON.stringify(s)); assert.equal(r.secondType, ref.second, JSON.stringify(s));
    assert.equal(Math.round(r.scoreGap * 10), ref.gap10, JSON.stringify(s));
    for (const c of CORE_TYPE_CODES) assert.equal(Math.round(r.matchScores[c] * 10), ref.all[c], `${c} ${JSON.stringify(s)}`);
  }
});

test("同点: 1位も2位も、得点の降順→定義順（CORE_TYPE_CODES）。乱数・時刻・ID は使わない", () => {
  // 全軸50: 全タイプ50.0で同点 → 定義順の先頭2つ
  const all50 = calculateCoreType(s6(50, 50, 50, 50, 50, 50));
  assert.deepEqual([all50.topType, all50.secondType, all50.scoreGap], ["shimei_jishaku", "aisare_ace", 0]);
  const zero = calculateCoreType(s6(0, 0, 0, 0, 0, 0));
  assert.deepEqual([zero.topType, zero.secondType, zero.scoreGap], ["shimei_jishaku", "aisare_ace", 0]);
  // 1位が単独で、2位が同点（実際の経験者の回答から見つかった例: aisare_ace 37 の下で repeat_king と iyashi_charisma が33.1）
  const t2 = calculateCoreType(s6(37, 17, 36, 15, 23, 39));
  assert.equal(t2.topType, "aisare_ace");
  assert.equal(t2.matchScores.repeat_king, t2.matchScores.iyashi_charisma);
  assert.equal(t2.secondType, "iyashi_charisma", "定義順で iyashi_charisma（5番目）が repeat_king（6番目）より先");
  // 同じ入力なら何度でも同じ（非決定的な要素なし）
  for (let i = 0; i < 50; i++) assert.deepEqual(calculateCoreType(s6(37, 17, 36, 15, 23, 39)), t2);
});

test("僅差: 1位と2位が0.1差のときは、同点扱いにせず得点の高い方を1位にする（差=0.1）", () => {
  let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  let found = 0;
  for (let i = 0; i < 200000 && found < 300; i++) {
    const s = s6(...(Array.from({ length: 6 }, () => Math.floor(rnd() * 101)) as [number, number, number, number, number, number]));
    const ref = reference(s);
    if (ref.gap10 !== 1) continue;
    found++;
    const r = calculateCoreType(s);
    assert.equal(r.scoreGap, 0.1);
    assert.ok(r.matchScores[r.topType] > r.matchScores[r.secondType]);
  }
  assert.ok(found >= 300);
});

test("丸め境界: 重み付き合計の小数第2位がちょうど5のとき、数学的な四捨五入（切り上げ）になる（DBの numeric round と同じ）", () => {
  // 実際の経験者の回答から見つかった例。浮動小数点では x.x4999… となり、変更前は 31.9 / 32.9 に切り下げていた。
  const a = calculateCoreType(s6(44, 17, 27, 22, 28, 22));
  assert.equal(a.matchScores.aisare_ace, 32, "31.95 → 32.0");
  assert.equal(a.secondType, "aisare_ace");
  const b = calculateCoreType(s6(37, 26, 36, 15, 30, 19));
  assert.equal(b.matchScores.aisare_ace, 33, "32.95 → 33.0");
  // 境界を持つ全ケースで、参照実装（整数計算）と一致すること。境界ケースの件数も確認する。
  let boundary = 0;
  for (let T = 0; T <= 100; T += 5) for (let H = 0; H <= 100; H += 5) for (let A = 0; A <= 100; A += 5) {
    const s = s6(T, 13, H, 7, A, 29);
    const h = CORE_TYPE_CODES.map((c) => K.reduce((x, k) => x + Math.round(CORE_TYPE_WEIGHTS[c][k] * 100) * s[k], 0));
    if (h.some((x) => x % 10 === 5)) boundary++;
    const r = calculateCoreType(s), ref = reference(s);
    for (const c of CORE_TYPE_CODES) assert.equal(Math.round(r.matchScores[c] * 10), ref.all[c]);
  }
  assert.ok(boundary > 1000, `境界ケース ${boundary}`);
});

test("重み表は、DBの関数（0078）に書かれた係数と同じ（アプリとDBで二重管理している係数の照合）", () => {
  const sql = readFileSync("docs/core-type-tiebreak-db/0078_core_type_tiebreak.draft.sql", "utf8");
  for (const c of CORE_TYPE_CODES) {
    const m = new RegExp(`\\('${c}'(?:::public\\.stylist_core_type)?,\\s*([0-9.]+),\\s*([0-9.]+),\\s*([0-9.]+),\\s*([0-9.]+),\\s*([0-9.]+),\\s*([0-9.]+)\\)`).exec(sql);
    assert.ok(m, `${c} の係数がSQLに無い`);
    K.forEach((k, i) => assert.equal(Number(m![i + 1]), CORE_TYPE_WEIGHTS[c][k], `${c}.${k}`));
  }
});
