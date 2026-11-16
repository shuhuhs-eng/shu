"use server";

import type { LimitErrorCode } from "@/lib/diagnosis-limit/messages";
import { STUDENT_CLOSED_MESSAGE } from "@/lib/student-diagnosis/closed";

export type SubmitStudentResult =
  | { success: true; action: string; replay: boolean; lockedUntil: string | null }
  | { success: false; code: LimitErrorCode | "unsupported" | "not_authenticated" | "closed"; message: string; lockedUntil?: string | null };

/**
 * 旧「新卒向け15問」の保存。**新しい保存は停止した**（入口は共通の30問に統一）。
 * 開いたままの旧画面からの送信も、ここ（サーバー）で拒否する。認証・DB・回数のどれにも触れない
 * （保存済みの結果・履歴・変更回数・ロックは書き換えない。保存済みの15問の結果の表示は影響を受けない）。
 * 停止前の保存処理は lib/student-diagnosis/commit.ts に残してある（DB関数 commit_student_diagnosis も無変更）。
 */
export async function submitStudentDiagnosisAction(answers: unknown, requestId: string): Promise<SubmitStudentResult> {
  void answers;
  void requestId;
  return { success: false, code: "closed", message: STUDENT_CLOSED_MESSAGE };
}
