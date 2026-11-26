"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { RECRUITING_PAUSED_MESSAGE, isRecruitingPausedError } from "@/lib/contracts/recruiting-access";
import type { AgeDisplayMode, AgeRequestDecision, AgeRequestStatus } from "@/types/database";
import { cardGateErrorMessage, salonCardBlockMessage } from "@/lib/billing/salon-card-gate";

const requestSchema = z.object({ storeId: z.string().uuid(), stylistUserId: z.string().uuid() });
const respondSchema = z.object({ requestId: z.string().uuid(), approve: z.boolean() });

export type AgeDisclosureActionResult =
  | { success: true; status: AgeRequestDecision }
  | { success: false; error: string };

/**
 * 実年齢の開示を依頼する（サロン側・店舗単位）。request_stylist_age_disclosure のみを呼ぶ薄いラッパー。
 * ・storeId は画面の店舗（URLのparams）をそのまま渡す。権限（can_manage_store_hiring）・対象・重複の判定はすべてDB側。
 * ・同じ店舗×美容師の再送・連打は、DBが同じ依頼を返す（新しい依頼は作られない）。
 * ・興味あり・スカウトなどの既存操作とは独立しており、依頼しても自動では何も開示されない（本人の承認が必要）。
 */
export async function requestAgeDisclosure(input: z.infer<typeof requestSchema>): Promise<AgeDisclosureActionResult> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "不正なリクエストです。" };
  const supabase = await createClient();
  const cardBlock = await salonCardBlockMessage(supabase);
  if (cardBlock) return { success: false, error: cardBlock };
  const { data, error } = await supabase.rpc("request_stylist_age_disclosure", {
    p_store_id: parsed.data.storeId,
    p_stylist_user_id: parsed.data.stylistUserId,
  });
  if (error || !data) {
    console.error("[requestAgeDisclosure] RPC failed", { message: error?.message, code: error?.code });
    const m = error?.message ?? "";
    if (isRecruitingPausedError(m)) return { success: false, error: RECRUITING_PAUSED_MESSAGE };
    const cardMsg = cardGateErrorMessage(m);
    if (cardMsg) return { success: false, error: cardMsg };
    if (m.includes("not allowed to request")) return { success: false, error: "この店舗で開示を依頼する権限がありません。" };
    if (m.includes("not needed")) return { success: false, error: "この美容師は実年齢を表示しています。依頼は不要です。" };
    return { success: false, error: "この美容師には依頼できません。" };
  }
  revalidatePath(`/salon/stores/${parsed.data.storeId}/stylists`);
  revalidatePath(`/salon/stores/${parsed.data.storeId}/interests`);
  return { success: true, status: data.status };
}

/** 承認・辞退（美容師本人のみ）。二重処理は同じ結果になり、逆の決定はDBが拒否する。 */
export async function respondAgeDisclosure(input: z.infer<typeof respondSchema>): Promise<AgeDisclosureActionResult> {
  const parsed = respondSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "不正なリクエストです。" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("respond_age_disclosure_request", {
    p_request_id: parsed.data.requestId,
    p_approve: parsed.data.approve,
  });
  if (error || !data) {
    console.error("[respondAgeDisclosure] RPC failed", { message: error?.message, code: error?.code });
    if ((error?.message ?? "").includes("age_disclosure_already_decided")) {
      return { success: false, error: "この依頼にはすでに回答済みです。画面を更新してください。" };
    }
    return { success: false, error: "回答できませんでした。時間をおいて、もう一度お試しください。" };
  }
  revalidatePath("/stylist/age-requests");
  return { success: true, status: data.status };
}

export type StoreAgeInfo = {
  stylist_user_id: string;
  age_display_mode: AgeDisplayMode | null;
  age_decade?: number;
  age?: number;
  age_request_status: AgeRequestStatus;
};

/**
 * 興味あり一覧など、候補一覧以外の画面向けの年齢情報（店舗にアクセスできるサロンのみ）。
 * 取得できない場合（未対応のDB・通信エラー）は空の表を返し、年齢は表示しない（推測しない）。
 */
export async function getStoreStylistAgeInfos(storeId: string, stylistUserIds: string[]): Promise<Record<string, StoreAgeInfo>> {
  const ok = z.string().uuid().safeParse(storeId).success && stylistUserIds.every((id) => z.string().uuid().safeParse(id).success);
  if (!ok || stylistUserIds.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_store_stylist_age_infos", { p_store_id: storeId, p_stylist_user_ids: stylistUserIds });
  if (error || !data) {
    console.error("[getStoreStylistAgeInfos] RPC failed", { message: error?.message, code: error?.code });
    return {};
  }
  return Object.fromEntries((data as StoreAgeInfo[]).map((r) => [r.stylist_user_id, r]));
}
