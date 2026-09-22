"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

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
