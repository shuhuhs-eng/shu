"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { logError } from "@/lib/security/log";
import { looseRpc } from "@/lib/diagnosis-limit/rpc";
import type { LimitErrorCode } from "@/lib/diagnosis-limit/messages";
import { commitStudentDiagnosis, type StudentCommitClient } from "@/lib/student-diagnosis/commit";
import { parseCareerPhaseInput, ymToDate, type CareerPhaseErrors } from "@/lib/student-diagnosis/career-phase";

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

export type CareerPhaseFormState = { status: "idle" } | { status: "saved" } | { status: "error"; message: string; fieldErrors?: CareerPhaseErrors };

function mapCareerPhaseDbError(err: { message?: string; code?: string } | null): string {
  const m = (err?.message ?? "").toLowerCase();
  if (m.includes("birth_date_required") || m.includes("age_display_mode_required"))
    return "区分を保存するには、先にプロフィールで生年月日と年齢の表示方法を登録してください。";
  if (m.includes("not authenticated")) return "ログインの有効期限が切れました。ログインし直してください。";
  if (m.includes("stylist profile not found")) return "先にプロフィールを保存してください。";
  if (m.includes("out of range") || m.includes("future") || m.includes("start month") || m.includes("required") || m.includes("planned") || m.includes("empty"))
    return "入力内容を確認してください。";
  return "保存できませんでした。もう一度お試しください。";
}

/** 区分（学生・新卒・経験者・未設定）を保存する。本人のJWTでDB関数 set_stylist_career_phase を呼ぶ。0071未適用ならエラー（保存しない）。 */
export async function saveCareerPhaseAction(_prev: CareerPhaseFormState, formData: FormData): Promise<CareerPhaseFormState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "ログインの有効期限が切れました。ログインし直してください。" };
  const parsed = parseCareerPhaseInput({
    phase: formData.get("phase"), graduationYm: formData.get("graduationYm"), graduationKind: formData.get("graduationKind"),
    desiredStartYm: formData.get("desiredStartYm"), licenseStatus: formData.get("licenseStatus"),
  });
  if (!parsed.ok) return { status: "error", message: "入力内容を確認してください。", fieldErrors: parsed.errors };
  const v = parsed.value;
  const { error } = await looseRpc(supabase).rpc("set_stylist_career_phase", {
    p_phase: v.phase, p_graduation_ym: ymToDate(v.graduationYm), p_graduation_kind: v.graduationKind,
    p_desired_start_ym: ymToDate(v.desiredStartYm), p_license_status: v.licenseStatus,
  });
  if (error) {
    logError("saveCareerPhase", error);
    return { status: "error", message: mapCareerPhaseDbError(error) };
  }
  revalidatePath("/stylist/profile");
  revalidatePath("/stylist/mypage");
  return { status: "saved" };
}
