"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isInterviewType, jstPartsToIso } from "@/lib/hiring/format";
import type {
  ActionResult,
  HiringProcessEvent,
  MyHiringProcess,
  StoreHiringProcess,
} from "@/lib/hiring/types";

/**
 * 採用進捗（0037）のRPCの薄いラッパー。権限チェック（salon role・
 * can_manage_store_hiring / is_store_accessible / 美容師本人）はすべてRPC側。
 * ここでは入力の形式チェックと、利用者向けの日本語エラーへの変換だけを行う。
 *
 * ★storeId/processIdは呼び出し元が明示的に渡した値のみ使う（auth.uid()や
 * 他のIDから推測しない）。生のエラー内容はサーバーログにのみ出し、画面には出さない。
 */
const uuidSchema = z.string().uuid();
const GENERIC_ERROR = "保存できませんでした。時間をおいて再度お試しください";

function friendlyError(message: string | undefined): string {
  const m = message ?? "";
  if (m.includes("candidate already exists")) return "すでに採用進捗に追加されています";
  if (m.includes("no engagement")) return "この美容師とはまだ接点がないため、採用進捗に追加できません";
  if (m.includes("not found or not accessible") || m.includes("caller is not")) {
    return "この操作を行う権限がありません";
  }
  if (m.includes("invalid status transition")) return "現在の状態からはこの変更はできません";
  if (m.includes("hired process cannot")) return "採用が確定した記録は変更できません";
  if (m.includes("already closed")) return "この選考はすでに終了しています";
  if (m.includes("reason is only allowed")) return "理由は辞退・不採用のときのみ入力できます";
  return GENERIC_ERROR;
}

function revalidateStore(storeId: string, processId?: string) {
  revalidatePath(`/salon/stores/${storeId}/candidates`);
  if (processId) revalidatePath(`/salon/stores/${storeId}/candidates/${processId}`);
  revalidatePath(`/salon/stores/${storeId}/interests`);
  revalidatePath(`/salon/stores/${storeId}/scouts`);
  revalidatePath(`/salon/stores/${storeId}/offers`);
}

// ---- 読み取り（失敗時はnull）-------------------------------------------------

export async function getStoreHiringProcesses(storeId: string): Promise<StoreHiringProcess[] | null> {
  const parsed = uuidSchema.safeParse(storeId);
  if (!parsed.success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_store_hiring_processes", { p_store_id: parsed.data });
  if (error || !data) {
    console.error("[getStoreHiringProcesses] RPC failed", { message: error?.message, code: error?.code, storeId });
    return null;
  }
  return data;
}

export async function getHiringProcessEvents(processId: string): Promise<HiringProcessEvent[] | null> {
  const parsed = uuidSchema.safeParse(processId);
  if (!parsed.success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_hiring_process_events", { p_process_id: parsed.data });
  if (error || !data) {
    console.error("[getHiringProcessEvents] RPC failed", { message: error?.message, code: error?.code, processId });
    return null;
  }
  return data;
}

export async function getMyHiringProcesses(): Promise<MyHiringProcess[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_hiring_processes");
  if (error || !data) {
    console.error("[getMyHiringProcesses] RPC failed", { message: error?.message, code: error?.code });
    return null;
  }
  return data;
}

// ---- 店舗側の書き込み --------------------------------------------------------

export async function addHiringCandidateAction(storeId: string, stylistUserId: string): Promise<ActionResult> {
  const store = uuidSchema.safeParse(storeId);
  const stylist = uuidSchema.safeParse(stylistUserId);
  if (!store.success || !stylist.success) return { success: false, error: GENERIC_ERROR };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_hiring_candidate", {
    p_store_id: store.data,
    p_stylist_user_id: stylist.data,
  });
  if (error) {
    console.error("[addHiringCandidateAction] RPC failed", { message: error.message, code: error.code, storeId });
    return { success: false, error: friendlyError(error.message) };
  }
  revalidateStore(store.data);
  return { success: true };
}

const scheduleSchema = z.object({
  storeId: z.string().uuid(),
  processId: z.string().uuid(),
  date: z.string(),
  time: z.string(),
  interviewType: z.string(),
  location: z.string().max(500, "場所/URLは500文字以内で入力してください"),
  candidateMessage: z.string().max(1000, "美容師への案内は1000文字以内で入力してください"),
  internalNote: z.string().max(2000, "社内メモは2000文字以内で入力してください"),
});

export async function scheduleHiringInterviewAction(
  input: z.input<typeof scheduleSchema>,
): Promise<ActionResult> {
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }
  const v = parsed.data;
  if (!isInterviewType(v.interviewType)) return { success: false, error: "面談形式を選択してください" };
  const iso = jstPartsToIso(v.date, v.time);
  if (!iso) return { success: false, error: "面談の日付と時刻を正しく入力してください" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("schedule_hiring_interview", {
    p_process_id: v.processId,
    p_interview_at: iso,
    p_interview_type: v.interviewType,
    p_location: v.location.trim() || null,
    p_candidate_message: v.candidateMessage.trim() || null,
    p_internal_note: v.internalNote.trim() || null,
  });
  if (error) {
    console.error("[scheduleHiringInterviewAction] RPC failed", { message: error.message, code: error.code });
    return { success: false, error: friendlyError(error.message) };
  }
  revalidateStore(v.storeId, v.processId);
  return { success: true };
}

const statusSchema = z.object({
  storeId: z.string().uuid(),
  processId: z.string().uuid(),
  toStatus: z.enum(["contacting", "interview_completed", "selection", "offered", "hired", "declined", "rejected"]),
  publicNote: z.string().max(1000, "美容師への案内は1000文字以内で入力してください"),
  internalNote: z.string().max(2000, "社内メモは2000文字以内で入力してください"),
  reasonCode: z
    .enum(["", "skill_mismatch", "culture_mismatch", "conditions_mismatch", "timing", "other_offer", "position_filled", "other"]),
  reasonNote: z.string().max(1000, "理由のメモは1000文字以内で入力してください"),
});

export async function updateHiringStatusAction(input: z.input<typeof statusSchema>): Promise<ActionResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_hiring_status", {
    p_process_id: v.processId,
    p_to_status: v.toStatus,
    p_public_note: v.publicNote.trim() || null,
    p_internal_note: v.internalNote.trim() || null,
    p_reason_code: v.reasonCode || null,
    p_reason_note: v.reasonNote.trim() || null,
  });
  if (error) {
    console.error("[updateHiringStatusAction] RPC failed", { message: error.message, code: error.code });
    return { success: false, error: friendlyError(error.message) };
  }
  revalidateStore(v.storeId, v.processId);
  return { success: true };
}

const noteSchema = z.object({
  storeId: z.string().uuid(),
  processId: z.string().uuid(),
  note: z.string().max(2000, "社内メモは2000文字以内で入力してください"),
});

export async function updateHiringInternalNoteAction(input: z.input<typeof noteSchema>): Promise<ActionResult> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_hiring_internal_note", {
    p_process_id: v.processId,
    p_internal_note: v.note.trim() || null,
  });
  if (error) {
    console.error("[updateHiringInternalNoteAction] RPC failed", { message: error.message, code: error.code });
    return { success: false, error: friendlyError(error.message) };
  }
  revalidateStore(v.storeId, v.processId);
  return { success: true };
}

// ---- 美容師側 ----------------------------------------------------------------

export async function declineHiringProcessAction(processId: string, note: string): Promise<ActionResult> {
  const parsed = uuidSchema.safeParse(processId);
  if (!parsed.success) return { success: false, error: GENERIC_ERROR };
  if (note.length > 1000) return { success: false, error: "メッセージは1000文字以内で入力してください" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_hiring_process", {
    p_process_id: parsed.data,
    p_public_note: note.trim() || null,
  });
  if (error) {
    console.error("[declineHiringProcessAction] RPC failed", { message: error.message, code: error.code });
    return { success: false, error: friendlyError(error.message) };
  }
  revalidatePath("/stylist/applications");
  revalidatePath("/stylist/mypage");
  return { success: true };
}
