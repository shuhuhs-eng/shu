"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { logError } from "@/lib/security/log";
import type { LimitErrorCode } from "@/lib/diagnosis-limit/messages";
import { commitStudentDiagnosis, type StudentCommitClient } from "@/lib/student-diagnosis/commit";

export type SubmitStudentResult =
  | { success: true; action: string; replay: boolean; lockedUntil: string | null }
  | { success: false; code: LimitErrorCode | "unsupported" | "not_authenticated"; message: string; lockedUntil?: string | null };

/** 学生・新卒診断を確定保存する。ログイン必須。回答からサーバーが結果を再計算し、回数制限はDB（経験者診断と共有）が判定する。 */
export async function submitStudentDiagnosisAction(answers: unknown, requestId: string): Promise<SubmitStudentResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, code: "not_authenticated", message: "ログインの有効期限が切れました。ログインし直してください。" };
  const committed = await commitStudentDiagnosis(createServiceClient() as unknown as StudentCommitClient, { userId: user.id, requestId, answers });
  if (!committed.ok) {
    logError("submitStudentDiagnosis.commit", { code: committed.error.code, unsupported: committed.unsupported });
    return { success: false, code: committed.unsupported ? "unsupported" : committed.error.code, message: committed.error.message, lockedUntil: committed.error.lockedUntil };
  }
  revalidatePath("/stylist/mypage");
  return { success: true, action: committed.action, replay: committed.replay, lockedUntil: committed.lockedUntil };
}
