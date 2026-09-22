export * from "./traits";
export * from "./types";
export * from "./questions";
export * from "./scoring";
export { DIAGNOSIS_VERSION, GOLDEN_TEST_VERSION } from "./version";

import type { TraitKey } from "./traits";
import type { DiagnosisMode } from "./questions";
import { bankFor } from "./questions";
import { scoreTraits, decideType, marketValue } from "./scoring";
import { DIAGNOSIS_VERSION } from "./version";

/**
 * 回答配列から確定結果を計算する。サーバー側の真値算出に使う。
 * クライアントの計算結果は信用せず、常にこの関数で回答から再計算する。
 */
export type ComputedDiagnosis = {
  diagnosisVersion: string;
  mode: DiagnosisMode;
  scores: Record<TraitKey, number>;
  typeId: string;
  typeName: string;
  marketValueScore: number | null;
  salaryBand: string | null;
};

export function computeDiagnosis(mode: DiagnosisMode, answers: number[]): ComputedDiagnosis {
  const bank = bankFor(mode);
  const { traits, meta } = scoreTraits(answers, bank);
  const type = decideType(traits);
  const mv = mode === "stylist" ? marketValue(traits, meta) : null;
  return {
    diagnosisVersion: DIAGNOSIS_VERSION,
    mode,
    scores: traits,
    typeId: type.id,
    typeName: type.name,
    marketValueScore: mv ? mv.score : null,
    salaryBand: mv ? mv.band : null,
  };
}

/** 回答配列の妥当性チェック（サーバー入力検証で使用） */
export function isValidAnswers(mode: DiagnosisMode, answers: unknown): answers is number[] {
  const bank = bankFor(mode);
  if (!Array.isArray(answers) || answers.length !== bank.length) return false;
  return answers.every((a, i) =>
    Number.isInteger(a) && a >= 0 && a < bank[i].opts.length,
  );
}
