"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const salonUserIdSchema = z.string().uuid();

/** 保存・解除の権限検証はset_favorite_salon() RPC内で行う。 */
export async function setFavoriteSalonAction(
  salonUserId: string,
  favorite: boolean,
): Promise<void> {
  const parsedSalonUserId = salonUserIdSchema.safeParse(salonUserId);
  if (!parsedSalonUserId.success) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_favorite_salon", {
    p_salon_user_id: parsedSalonUserId.data,
    p_favorite: favorite,
  });

  if (error) {
    console.error("[setFavoriteSalonAction] RPC failed", {
      message: error.message,
      code: error.code,
      salonUserId: parsedSalonUserId.data,
    });
    return;
  }

  revalidatePath("/stylist/salons");
  revalidatePath(`/stylist/salons/${parsedSalonUserId.data}`);
  revalidatePath("/stylist/mypage");
}
