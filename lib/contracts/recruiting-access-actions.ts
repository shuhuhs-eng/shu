"use server";

import { createClient } from "@/lib/supabase/server";
import { toRecruitingAccessView, type RecruitingAccessView } from "@/lib/contracts/recruiting-access";

/**
 * 店舗が新しい採用活動を受け付けているか（get_store_recruiting_access、0044）。
 * storeIdは呼び出し元（URLのparams.storeId）が渡した値のみ使う。
 * 取得に失敗した場合は paused=false を返す（最終防衛はDBのguard）。
 */
export async function getStoreRecruitingAccess(storeId: string): Promise<RecruitingAccessView> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_store_recruiting_access", { p_store_id: storeId });
  if (error) {
    console.error("[getStoreRecruitingAccess] RPC failed", { message: error.message, code: error.code, storeId });
    return { paused: false };
  }
  return toRecruitingAccessView(data);
}
