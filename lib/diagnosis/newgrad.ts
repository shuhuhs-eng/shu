import { Q, QS, type DiagnosisMode, type Question } from "./questions";
import { Q_NEWGRAD } from "./newgrad-questions";
import { DIAGNOSIS_VERSION } from "./version";

/**
 * 新卒版（これから美容師として働く人向け）の30問。経験者版（Q・版 "1.0.0"）とは別の診断バージョンとして保存する。
 * ・共通入口は1問目（Q_NEWGRAD[0]）。選択肢 0〜3 は経験者版の p1 と同じ文言・同じ添字、4 が「新卒・これから美容師として働く」。
 * ・1問目の回答（添字）で、2問目以降のセットが決まる。4=新卒版 / 0〜3=経験者版。
 * ・1問目と3問目は、新卒版では全選択肢が採点対象外（分子・分母に入れない）。質問・配点は設計JSONが正本（newgrad-questions.ts は自動生成）。
 */
export const NEWGRAD_VERSION = "stylist_newgrad_30_v1";
export const NEWGRAD_ENTRY_INDEX = 4;

export type DiagnosisSetId = "experienced" | "newgrad";

/** 共通入口の1問目。 */
export const ENTRY_QUESTION: Question = Q_NEWGRAD[0];

/** 1問目の回答（添字）から、使うセットを決める。範囲外・非整数は null。 */
export function setFromFirstAnswer(a: unknown): DiagnosisSetId | null {
  if (!Number.isInteger(a)) return null;
  const n = a as number;
  if (n === NEWGRAD_ENTRY_INDEX) return "newgrad";
  if (n >= 0 && n < Q[0].opts.length) return "experienced";
  return null;
}

/** 画面で出す30問。経験者版は、1問目だけ共通入口（5択）に差し替える（2問目以降は既存Qそのまま）。 */
export function quizBankFor(set: DiagnosisSetId): Question[] {
  return set === "newgrad" ? Q_NEWGRAD : [ENTRY_QUESTION, ...Q.slice(1)];
}

export function versionOfSet(set: DiagnosisSetId): string {
  return set === "newgrad" ? NEWGRAD_VERSION : DIAGNOSIS_VERSION;
}

export function questionIdsOf(set: DiagnosisSetId): string[] {
  return quizBankFor(set).map((q) => q.id);
}

/** 保存済みの版名から、(モード, 版) に対応する質問バンクを返す。未知の版は null（回答の破損ではない）。 */
export function bankForVersion(mode: DiagnosisMode, version: unknown): { bank: Question[]; set: DiagnosisSetId } | null {
  if (mode === "salon") return version === DIAGNOSIS_VERSION ? { bank: QS, set: "experienced" } : null;
  if (version === DIAGNOSIS_VERSION) return { bank: Q, set: "experienced" };
  if (version === NEWGRAD_VERSION) return { bank: Q_NEWGRAD, set: "newgrad" };
  return null;
}

/** 回答配列が、そのバンクに対して形式上正しいか（問数・各選択肢の範囲）。新卒版は1問目が新卒の選択であることも要求。 */
export function answersFitBank(bank: Question[], set: DiagnosisSetId, answers: unknown): answers is number[] {
  if (!Array.isArray(answers) || answers.length !== bank.length) return false;
  if (!answers.every((a, i) => Number.isInteger(a) && a >= 0 && a < bank[i].opts.length)) return false;
  return set !== "newgrad" || answers[0] === NEWGRAD_ENTRY_INDEX;
}

/**
 * 新卒入口（1問目の5つ目の選択肢）を出すか。環境変数 NEWGRAD_ENTRY_ENABLED が "true"/"1"/"on" のときだけ有効（**未設定・その他は無効**）。
 * 無効の間も、保存済みの新卒の保留データの引き継ぎ（claim）・診断結果の表示・経験者版の診断は続く。止まるのは、新卒の入口（画面）と新卒の新規送信（サーバーが拒否）だけ。
 * コードを古い版へ戻さずに入口を閉じられる（公開・提供停止・巻き戻しの安全弁）。
 */
export function isNewgradEntryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.NEWGRAD_ENTRY_ENABLED ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "on";
}

/** 入口を止めているときの1問目（5つ目を除く）。 */
export function entryQuestionFor(enabled: boolean): Question {
  return enabled ? ENTRY_QUESTION : { ...ENTRY_QUESTION, opts: ENTRY_QUESTION.opts.slice(0, NEWGRAD_ENTRY_INDEX) };
}

/** 新卒入口が閉じられた（NEWGRAD_ENTRY_ENABLED が無効）後に、開いたままの画面から新卒の回答が送られたときの案内。再送しても同じ結果になるため、再送は促さない。 */
export const NEWGRAD_CLOSED_MESSAGE =
  "現在、新卒向けの診断は受け付けていません。1問目で「美容師として経験がある」を選び直すと、続きから診断を受けられます。";

/** 送信エラーのうち、画面側で専用の案内にするもの。該当しなければ null（従来どおりの表示）。 */
export function submissionErrorNotice(error: unknown): { message: string; retryable: boolean } | null {
  if (error === "newgrad_disabled") return { message: NEWGRAD_CLOSED_MESSAGE, retryable: false };
  return null;
}
