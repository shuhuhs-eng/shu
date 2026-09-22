/**
 * Golden スナップショット再生成スクリプト。
 *
 * lib/diagnosis の「現在のロジック」を基準（=次回以降の比較対象となる旧ロジック）
 * として、ランダムな回答パターンから期待値を生成し scripts/diagnosis-golden.json
 * に書き出す。生成物には DIAGNOSIS_VERSION と GOLDEN_TEST_VERSION をメタ情報として
 * 焼き込む。
 *
 * 実行するタイミング（どちらか）:
 *   1. 診断ロジックを意図的に変更し、DIAGNOSIS_VERSION を上げた直後
 *      （新しい値を「新しい正解」として golden を更新する）
 *   2. スナップショットテストの比較項目・件数・生成方法を変更し、
 *      GOLDEN_TEST_VERSION を上げた直後
 *
 * 実行: npm run generate:golden
 *
 * 注意: このスクリプトを実行すると golden.json が上書きされる。
 * 「新ロジックが正しいことをレビュー済み」の場合のみ実行すること。
 * レビュー前に実行すると、バグを golden ごと固定してしまう。
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  Q,
  QS,
  scoreTraits,
  decideType,
  marketValue,
  cosine,
  matchPct,
  DIAGNOSIS_VERSION,
  GOLDEN_TEST_VERSION,
  type Question,
  type TraitKey,
  type TraitScores,
} from "../lib/diagnosis/index";

const SEED = 20260729;
const N_DIAGNOSIS = 1000; // 美容師・サロン それぞれ1000件（最低1000パターンの要件を満たす）
const N_COMPAT = 1000;    // 相性スコアのペア数

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);

const TRAIT_ORDER: TraitKey[] = ["T", "S", "H", "B", "A", "M"];
function ranking(traits: TraitScores): TraitKey[] {
  return [...TRAIT_ORDER].sort(
    (a, b) => traits[b] - traits[a] || TRAIT_ORDER.indexOf(a) - TRAIT_ORDER.indexOf(b),
  );
}

function diagCases(bank: Question[], n: number, withMv: boolean) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = bank.map((q) => Math.floor(rand() * q.opts.length));
    const { traits, meta } = scoreTraits(a, bank);
    const type = decideType(traits);
    const mv = withMv ? marketValue(traits, meta) : null;
    out.push({
      a,
      scores: traits,
      ranking: ranking(traits),
      typeId: type.id,
      mvScore: mv ? mv.score : null,
      band: mv ? mv.band : null,
    });
  }
  return out;
}

function compatCases(n: number) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const mk = (): TraitScores =>
      Object.fromEntries(TRAIT_ORDER.map((k) => [k, Math.floor(rand() * 101)])) as TraitScores;
    const s = mk();
    const sal = mk();
    out.push({ s, sal, cosine: cosine(s, sal), matchPct: matchPct(s, sal) });
  }
  return out;
}

const golden = {
  meta: {
    diagnosisVersion: DIAGNOSIS_VERSION,
    goldenTestVersion: GOLDEN_TEST_VERSION,
    generatedAt: new Date().toISOString(),
    seed: SEED,
    generatedFrom: "lib/diagnosis (current code, treated as baseline for future comparisons)",
  },
  stylist: diagCases(Q, N_DIAGNOSIS, true),
  salon: diagCases(QS, N_DIAGNOSIS, false),
  compat: compatCases(N_COMPAT),
};

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, "diagnosis-golden.json"), JSON.stringify(golden));

console.log("golden regenerated:");
console.log("  diagnosisVersion  =", DIAGNOSIS_VERSION);
console.log("  goldenTestVersion =", GOLDEN_TEST_VERSION);
console.log("  stylist cases     =", golden.stylist.length);
console.log("  salon cases       =", golden.salon.length);
console.log("  compat pairs      =", golden.compat.length);
