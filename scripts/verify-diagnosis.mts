/**
 * 診断ロジック スナップショットテスト（旧ロジック → 新ロジック）
 *
 * scripts/diagnosis-golden.json は旧ロジック（プロトタイプ = BeautyReach.jsx の
 * 判定コードそのもの）で生成した期待値スナップショット。
 * このテストは lib/diagnosis（新ロジック = TypeScript移植版）で同じ入力を
 * 再計算し、以下5項目すべてが完全一致するかを検証する。
 *
 *   1. 6才能スコア（craft/sense/hospitality/brand/drive/mentor）
 *   2. タイプ（typeId）
 *   3. 市場価値（score・年収帯）
 *   4. ランキング（6才能の順位＝並び順）
 *   5. 相性スコア（cosine類似度・matchPct）
 *
 * 1件でも不一致があれば非ゼロで終了し、失敗として扱う。
 * 実行: npm run verify:diagnosis
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  Q,
  QS,
  scoreTraits,
  decideType,
  marketValue,
  matchPct,
  cosine,
  DIAGNOSIS_VERSION,
  GOLDEN_TEST_VERSION,
  type Question,
  type TraitKey,
  type TraitScores,
} from "../lib/diagnosis/index";

type GoldenMeta = {
  diagnosisVersion: string;
  goldenTestVersion: string;
  generatedAt: string;
  seed: number;
  generatedFrom: string;
};

type DiagCase = {
  a: number[];
  scores: Record<string, number>;
  ranking: string[];
  typeId: string;
  mvScore: number | null;
  band: string | null;
};
type CompatCase = { s: TraitScores; sal: TraitScores; cosine: number; matchPct: number };
type Golden = { meta: GoldenMeta; stylist: DiagCase[]; salon: DiagCase[]; compat: CompatCase[] };

const TRAIT_ORDER: TraitKey[] = ["T", "S", "H", "B", "A", "M"];

/** 6才能の完全ランキング（降順）。同点は TRAIT_ORDER でタイブレーク＝golden生成側と同一ルール。 */
function ranking(traits: TraitScores): TraitKey[] {
  return [...TRAIT_ORDER].sort(
    (a, b) => traits[b] - traits[a] || TRAIT_ORDER.indexOf(a) - TRAIT_ORDER.indexOf(b),
  );
}

const here = dirname(fileURLToPath(import.meta.url));
const golden: Golden = JSON.parse(readFileSync(join(here, "diagnosis-golden.json"), "utf8"));

// --------------------------------------------------------------------------
// バージョンガード: golden がどの DIAGNOSIS_VERSION / GOLDEN_TEST_VERSION で
// 生成されたかを確認し、現在のコードと一致しなければ比較を行わず即座に失敗する。
// これにより「バージョンがずれた golden を気づかず比較して見かけ上PASS/FAILする」
// 事故を防ぐ。
// --------------------------------------------------------------------------
if (!golden.meta) {
  console.error("FAIL: golden.json に meta (diagnosisVersion/goldenTestVersion) がありません。");
  console.error("      npm run generate:golden で再生成してください。");
  process.exit(1);
}
if (golden.meta.diagnosisVersion !== DIAGNOSIS_VERSION) {
  console.error("FAIL: DIAGNOSIS_VERSION が golden と一致しません。");
  console.error(`      golden.meta.diagnosisVersion = ${golden.meta.diagnosisVersion}`);
  console.error(`      現在の DIAGNOSIS_VERSION      = ${DIAGNOSIS_VERSION}`);
  console.error("      診断ロジックを意図的に変更した場合は、変更内容をレビューした上で");
  console.error("      npm run generate:golden を実行し、新しい正解として golden を更新してください。");
  console.error("      意図的な変更でない場合は、DIAGNOSIS_VERSION またはロジックの変更を確認してください。");
  process.exit(1);
}
if (golden.meta.goldenTestVersion !== GOLDEN_TEST_VERSION) {
  console.error("FAIL: GOLDEN_TEST_VERSION が golden と一致しません。");
  console.error(`      golden.meta.goldenTestVersion = ${golden.meta.goldenTestVersion}`);
  console.error(`      現在の GOLDEN_TEST_VERSION      = ${GOLDEN_TEST_VERSION}`);
  console.error("      スナップショットテストの比較項目・形式を変更した場合は、");
  console.error("      npm run generate:golden を実行して golden を再生成してください。");
  process.exit(1);
}

type Tally = { total: number; fail: number; diffs: string[] };
const t = (): Tally => ({ total: 0, fail: 0, diffs: [] });

const scoreTally = t();
const typeTally = t();
const mvTally = t();
const rankTally = t();
const compatTally = t();

function record(tally: Tally, ok: boolean, detail: () => string): void {
  tally.total++;
  if (!ok) {
    tally.fail++;
    if (tally.diffs.length < 5) tally.diffs.push(detail());
  }
}

function checkDiagnosis(cases: DiagCase[], bank: Question[], withMv: boolean): void {
  for (const c of cases) {
    const { traits, meta } = scoreTraits(c.a, bank);
    const type = decideType(traits);
    const mv = withMv ? marketValue(traits, meta) : null;
    const rank = ranking(traits);

    record(
      scoreTally,
      JSON.stringify(traits) === JSON.stringify(c.scores),
      () => `scores mismatch answers=${JSON.stringify(c.a)} got=${JSON.stringify(traits)} want=${JSON.stringify(c.scores)}`,
    );

    record(
      typeTally,
      type.id === c.typeId,
      () => `type mismatch answers=${JSON.stringify(c.a)} got=${type.id} want=${c.typeId}`,
    );

    if (withMv) {
      record(
        mvTally,
        mv!.score === c.mvScore && mv!.band === c.band,
        () => `marketValue mismatch answers=${JSON.stringify(c.a)} got=${JSON.stringify(mv)} want=${JSON.stringify({ score: c.mvScore, band: c.band })}`,
      );
    }

    record(
      rankTally,
      JSON.stringify(rank) === JSON.stringify(c.ranking),
      () => `ranking mismatch answers=${JSON.stringify(c.a)} got=${JSON.stringify(rank)} want=${JSON.stringify(c.ranking)}`,
    );
  }
}

function checkCompat(cases: CompatCase[]): void {
  for (const c of cases) {
    const cos = cosine(c.s, c.sal);
    const pct = matchPct(c.s, c.sal);
    const ok = Math.abs(cos - c.cosine) < 1e-9 && pct === c.matchPct;
    record(
      compatTally,
      ok,
      () => `compat mismatch s=${JSON.stringify(c.s)} sal=${JSON.stringify(c.sal)} got=${JSON.stringify({ cosine: cos, matchPct: pct })} want=${JSON.stringify({ cosine: c.cosine, matchPct: c.matchPct })}`,
    );
  }
}

checkDiagnosis(golden.stylist, Q, true);
checkDiagnosis(golden.salon, QS, false);
checkCompat(golden.compat);

const totalCases = golden.stylist.length + golden.salon.length;
const totalFail = scoreTally.fail + typeTally.fail + mvTally.fail + rankTally.fail + compatTally.fail;

function pctStr(tally: Tally): string {
  if (tally.total === 0) return "n/a";
  return (((tally.total - tally.fail) / tally.total) * 100).toFixed(2) + "%";
}

console.log("=== 診断ロジック スナップショットテスト結果 ===");
console.log(`diagnosisVersion: ${DIAGNOSIS_VERSION} / goldenTestVersion: ${GOLDEN_TEST_VERSION} (golden と一致)`);
console.log(`診断ケース数（旧ロジック生成・美容師+サロン）: ${totalCases}`);
console.log(`相性ペア数: ${golden.compat.length}`);
console.log("---");
console.log(`① 6才能スコア   : ${scoreTally.total - scoreTally.fail}/${scoreTally.total} 一致 (${pctStr(scoreTally)})`);
console.log(`② タイプ        : ${typeTally.total - typeTally.fail}/${typeTally.total} 一致 (${pctStr(typeTally)})`);
console.log(`③ 市場価値      : ${mvTally.total - mvTally.fail}/${mvTally.total} 一致 (${pctStr(mvTally)})`);
console.log(`④ ランキング    : ${rankTally.total - rankTally.fail}/${rankTally.total} 一致 (${pctStr(rankTally)})`);
console.log(`⑤ 相性スコア    : ${compatTally.total - compatTally.fail}/${compatTally.total} 一致 (${pctStr(compatTally)})`);
console.log("---");

const allTallies = [scoreTally, typeTally, mvTally, rankTally, compatTally];
const allDiffs = allTallies.flatMap((tt) => tt.diffs);
if (allDiffs.length) {
  console.log("--- 差分（先頭のみ） ---");
  allDiffs.forEach((d) => console.log(d));
}

if (totalFail === 0) {
  console.log(`合計 ${totalCases + golden.compat.length} 件、一致率 100%。PASS.`);
} else {
  console.log(`合計不一致件数: ${totalFail}。FAIL.`);
}

process.exit(totalFail ? 1 : 0);
