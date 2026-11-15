import { mapLimitError, type LimitError } from "@/lib/diagnosis-limit/messages";
import { computeStudentResult } from "@/lib/student-diagnosis/result";
import { STUDENT_DIAGNOSIS_VERSION, isValidStudentAnswers } from "@/lib/student-diagnosis/questions";

/**
 * 学生・新卒診断の確定保存。0071の commit_student_diagnosis（service_role専用）を呼ぶ。
 * 回数制限は経験者診断と同じ状態（kind='stylist'）をDBが共有して判定する。アプリ側の事前確認は案内用にすぎない。
 * ★0071が未適用（関数が無い）のときは保存しない（旧経路・直接INSERTへのフォールバックは作らない）。
 */
export type StudentCommitClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: Record<string, unknown> | null;
    error: { message?: string; details?: string; code?: string } | null;
  }>;
};
export type StudentCommitOk = { ok: true; resultId: string; action: string; replay: boolean; lockedUntil: string | null };
export type StudentCommitErr = { ok: false; unsupported: boolean; error: LimitError };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** この関数が存在しない（0071未適用）ときだけ真。他の関数・権限・通信の失敗では真にしない。 */
export function isMissingStudentFunction(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  return (err.code === "PGRST202" || err.code === "42883") && (err.message ?? "").includes("commit_student_diagnosis");
}

export async function commitStudentDiagnosis(
  client: StudentCommitClient,
  a: { userId: string; requestId: string; answers: unknown },
): Promise<StudentCommitOk | StudentCommitErr> {
  if (!isValidStudentAnswers(a.answers) || !UUID_RE.test(a.requestId)) {
    return { ok: false, unsupported: false, error: { code: "unknown", lockedUntil: null, definite: true, message: "回答の内容を確認できませんでした。最初からやり直してください。" } };
  }
  // サーバーが回答から作り直す（画面から届いた結果は使わない）。
  const result = computeStudentResult(a.answers, STUDENT_DIAGNOSIS_VERSION);
  let rpc: Awaited<ReturnType<StudentCommitClient["rpc"]>>;
  try {
    rpc = await client.rpc("commit_student_diagnosis", {
      p_user_id: a.userId, p_request_id: a.requestId, p_version: STUDENT_DIAGNOSIS_VERSION, p_answers: a.answers, p_result: result,
    });
  } catch {
    return { ok: false, unsupported: false, error: mapLimitError(null) };
  }
  const { data, error } = rpc;
  if (!error && data && typeof data === "object" && data.result_id) {
    return {
      ok: true, resultId: String(data.result_id), action: String(data.action ?? ""), replay: data.replay === true,
      lockedUntil: typeof data.locked_until === "string" ? data.locked_until : null,
    };
  }
  if (isMissingStudentFunction(error)) {
    return { ok: false, unsupported: true, error: { code: "unknown", lockedUntil: null, definite: true, message: "この診断は、まだご利用いただけません。" } };
  }
  return { ok: false, unsupported: false, error: mapLimitError(error) };
}
