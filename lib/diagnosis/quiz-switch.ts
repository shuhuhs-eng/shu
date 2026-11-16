import type { DiagnosisMode } from "./questions";
import { setFromFirstAnswer } from "./newgrad";

/**
 * 診断クイズで、1問目の回答を変えたときの扱い（画面の状態遷移の中の、純粋な判定だけを切り出したもの）。
 * - same: 同じセットのまま（2問目以降はそのまま。確認画面から「直す」で来た場合は確認画面へ戻る）
 * - switch: 別のセット（経験者版↔新卒版）になり、2問目以降に回答が無い → すぐ切り替える
 * - confirm: 別のセットになり、2問目以降に回答がある → 消してよいか確認してから切り替える
 * サロン診断・1問目以外では常に same。
 */
export type FirstAnswerPlan = "same" | "switch" | "confirm";

export function planFirstAnswerChange(mode: DiagnosisMode, index: number, answers: ReadonlyArray<number | null>, optionIndex: number): FirstAnswerPlan {
  if (mode !== "stylist" || index !== 0) return "same";
  const before = setFromFirstAnswer(answers[0]);
  const after = setFromFirstAnswer(optionIndex);
  if (!before || !after || before === after) return "same";
  return answers.slice(1).some((a) => a !== null) ? "confirm" : "switch";
}

/** セットを切り替えたあとの回答。1問目だけ残し、2問目以降はすべて未回答に戻す。 */
export function answersAfterSwitch(length: number, optionIndex: number): Array<number | null> {
  const next: Array<number | null> = Array(length).fill(null);
  next[0] = optionIndex;
  return next;
}
