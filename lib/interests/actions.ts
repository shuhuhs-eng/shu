"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { RECRUITING_PAUSED_MESSAGE, isRecruitingPausedError } from "@/lib/contracts/recruiting-access";

const salonUserIdSchema = z.string().uuid();

/** 送信・取消の権限検証はset_salon_interest() RPC内で行う。 */
export async function setSalonInterestAction(
  salonUserId: string,
  interested: boolean,
): Promise<void> {
  const parsedSalonUserId = salonUserIdSchema.safeParse(salonUserId);
  if (!parsedSalonUserId.success) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_salon_interest", {
    p_salon_user_id: parsedSalonUserId.data,
    p_interested: interested,
  });

  if (error) {
    console.error("[setSalonInterestAction] RPC failed", {
      message: error.message,
      code: error.code,
      salonUserId: parsedSalonUserId.data,
    });
    return;
  }

  revalidatePath(`/stylist/salons/${parsedSalonUserId.data}`);
  revalidatePath("/salon/mypage");
}

const storeIdSchema = z.string().uuid();

/**
 * 店舗単位「話を聞いてみたい」の送信・取消（Phase 6）。set_store_interest()
 * のみを呼ぶ。storeIdは呼び出し元（URLのparams.storeId）が明示的に渡す値で、
 * salon_user_idは一切渡さない。権限検証（stylist role・PUBLIC店舗）はRPC内。
 */
export async function setStoreInterestAction(
  storeId: string,
  interested: boolean,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsedStoreId = storeIdSchema.safeParse(storeId);
  if (!parsedStoreId.success) {
    return { success: false, error: "送信できませんでした。もう一度お試しください" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_store_interest", {
    p_store_id: parsedStoreId.data,
    p_interested: interested,
  });

  if (error) {
    console.error("[setStoreInterestAction] RPC failed", {
      message: error.message,
      code: error.code,
      storeId: parsedStoreId.data,
    });
    // 新規の「話を聞いてみたい」は停止中の店舗には送れない（既に送信済みの再送・取り消しは影響なし）。
    if (isRecruitingPausedError(error.message)) {
      return { success: false, error: RECRUITING_PAUSED_MESSAGE };
    }
    return { success: false, error: "送信できませんでした。もう一度お試しください" };
  }

  revalidatePath(`/stylist/salons/${parsedStoreId.data}`);
  revalidatePath(`/salon/stores/${parsedStoreId.data}/interests`);
  return { success: true };
}
