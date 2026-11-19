"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { RECRUITING_PAUSED_MESSAGE, isRecruitingPausedError } from "@/lib/contracts/recruiting-access";
import { logError } from "@/lib/security/log";
import { isInterestKind, isMissingRpcError, type InterestKind } from "@/lib/interests/kinds";

const GENERIC_ERROR = "送信できませんでした。もう一度お試しください";
const TRIAL_UNAVAILABLE = "体験入店の希望は、現在準備中です。しばらくしてからお試しください";

const storeIdSchema = z.string().uuid();

/**
 * 店舗単位「見学を希望したい」の送信・取消（Phase 6）。set_store_interest()
 * のみを呼ぶ。storeIdは呼び出し元（URLのparams.storeId）が明示的に渡す値で、
 * salon_user_idは一切渡さない。権限検証（stylist role・PUBLIC店舗）はRPC内。
 */
export async function setStoreInterestAction(
  storeId: string,
  kind: InterestKind,
  interested: boolean,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsedStoreId = storeIdSchema.safeParse(storeId);
  if (!parsedStoreId.success || !isInterestKind(kind)) {
    return { success: false, error: GENERIC_ERROR };
  }

  const supabase = await createClient();
  let { error } = await supabase.rpc("set_store_interest_v2", {
    p_store_id: parsedStoreId.data,
    p_kind: kind,
    p_interested: interested,
  });

  // DB未適用（0095より前）: 見学は旧RPCで送信・取消できる。体験入店は送れない（見学へ読み替えない）。
  if (error && isMissingRpcError(error)) {
    if (kind === "trial") {
      return { success: false, error: TRIAL_UNAVAILABLE };
    }
    ({ error } = await supabase.rpc("set_store_interest", {
      p_store_id: parsedStoreId.data,
      p_interested: interested,
    }));
  }

  if (error) {
    logError("setStoreInterestAction", error);
    // 新規送信のみ停止中の店舗には送れない（取消は店舗の状態に関係なく可能）。
    if (isRecruitingPausedError(error.message)) {
      return { success: false, error: RECRUITING_PAUSED_MESSAGE };
    }
    return { success: false, error: GENERIC_ERROR };
  }

  revalidatePath(`/stylist/salons/${parsedStoreId.data}`);
  revalidatePath(`/salon/stores/${parsedStoreId.data}/interests`);
  return { success: true };
}
