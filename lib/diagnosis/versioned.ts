import type { DiagnosisMode } from "./questions";
import { Q } from "./questions";
import { scoreTraits, decideType, marketValue } from "./scoring";
import type { ComputedDiagnosis } from "./index";
import {
  ENTRY_QUESTION, answersFitBank, bankForVersion, questionIdsOf, quizBankFor, setFromFirstAnswer, versionOfSet,
  type DiagnosisSetId,
} from "./newgrad";
import { QS } from "./questions";
import { DIAGNOSIS_VERSION } from "./version";

/** 保存済みの版名と回答から、結果を再計算する。 */
export type ResolveResult =
  | { kind: "ok"; computed: ComputedDiagnosis; set: DiagnosisSetId }
  /** 版は分かるが、回答がその版の質問に合わない（回復しない破損）。 */
  | { kind: "corrupt" }
  /** このコードが知らない版（新しい版で保存された等）。回答の破損ではない。 */
  | { kind: "unknown_version" };

function compute(mode: DiagnosisMode, answers: number[], version: string, set: DiagnosisSetId): ComputedDiagnosis {
  const found = bankForVersion(mode, version)!;
  const { traits, meta } = scoreTraits(answers, found.bank);
  const type = decideType(traits);
  // 市場価値・年収帯は経験者版だけ。新卒版は計算せず null（経験年数2の既定値で作らない）。
  const mv = mode === "stylist" && set === "experienced" ? marketValue(traits, meta) : null;
  return {
    diagnosisVersion: version, mode, scores: traits, typeId: type.id, typeName: type.name,
    marketValueScore: mv ? mv.score : null, salaryBand: mv ? mv.band : null,
  };
}

/** 引き継ぎ（claim）など、保存済みデータを読み直す側が使う。保存された診断バージョンの質問・検証・計算を使う。 */
export function resolveDiagnosis(mode: DiagnosisMode, answers: unknown, version: unknown): ResolveResult {
  const found = bankForVersion(mode, version);
  if (!found) return { kind: "unknown_version" };
  if (!answersFitBank(found.bank, found.set, answers)) return { kind: "corrupt" };
  return { kind: "ok", computed: compute(mode, answers, version as string, found.set), set: found.set };
}

export type Declared = { setVersion?: unknown; questionIds?: unknown };
export type VerifyResult =
  | { ok: true; version: string; set: DiagnosisSetId; computed: ComputedDiagnosis }
  | { ok: false; error: "invalid_answers" | "set_mismatch" | "newgrad_disabled" };

/**
 * 送信時の検証。公式な版（保存する版）は、サーバーが1問目の回答から決める。クライアントが申告した版・質問IDは、
 * その版の質問順と一致するかの照合だけに使う（混在した送信を弾く）。
 * 限界: 回答の意味（その選択肢を本当にその質問で選んだか）までは証明できない。クライアントの自己申告との整合を見るだけ。
 * 申告が無い送信（古い画面からの送信）は、経験者版の形のときだけ受け付ける（新卒版は申告を必須にする）。
 */
export function verifySubmission(mode: DiagnosisMode, answers: unknown, declared?: Declared, opts: { newgradEnabled?: boolean } = {}): VerifyResult {
  let set: DiagnosisSetId;
  if (mode === "salon") set = "experienced";
  else {
    if (!Array.isArray(answers)) return { ok: false, error: "invalid_answers" };
    const s = setFromFirstAnswer(answers[0]);
    if (!s) return { ok: false, error: "invalid_answers" };
    set = s;
  }
  // 入口を止めている間は、新卒の新規送信を受け付けない（保存済みデータの読み取り・引き継ぎには影響しない）。
  if (mode === "stylist" && set === "newgrad" && opts.newgradEnabled === false) return { ok: false, error: "newgrad_disabled" };
  const version = mode === "salon" ? DIAGNOSIS_VERSION : versionOfSet(set);
  const bank = mode === "salon" ? QS : quizBankFor(set);
  const hasDecl = declared && (declared.setVersion !== undefined || declared.questionIds !== undefined);
  if (hasDecl) {
    const ids = mode === "salon" ? QS.map((q) => q.id) : questionIdsOf(set);
    const d = declared!;
    const same = d.setVersion === version && Array.isArray(d.questionIds) && d.questionIds.length === ids.length && d.questionIds.every((x, i) => x === ids[i]);
    if (!same) return { ok: false, error: "set_mismatch" };
  } else if (mode === "stylist" && set === "newgrad") {
    return { ok: false, error: "set_mismatch" };
  }
  if (mode === "salon") {
    if (!Array.isArray(answers) || answers.length !== bank.length || !answers.every((a, i) => Number.isInteger(a) && a >= 0 && a < bank[i].opts.length)) return { ok: false, error: "invalid_answers" };
  } else if (!answersFitBank(set === "newgrad" ? bank : [ENTRY_QUESTION, ...Q.slice(1)], set, answers)) {
    return { ok: false, error: "invalid_answers" };
  }
  // 経験者版の計算は、既存の Q（1問目は添字0〜3で同じ意味）で行う。保存する版・計算は従来どおり。
  return { ok: true, version, set, computed: compute(mode, answers as number[], version, set) };
}
