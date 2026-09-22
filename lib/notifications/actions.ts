"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const markReadSchema = z.object({ notificationId: z.string().uuid() });

export async function markNotificationRead(
  input: z.infer<typeof markReadSchema>,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = markReadSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "通知を確認できませんでした。" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notification_read", {
    p_notification_id: parsed.data.notificationId,
  });
  if (error) return { success: false, error: "既読にできませんでした。" };
  revalidatePath("/stylist/mypage");
  revalidatePath("/salon/mypage");
  return { success: true };
}

export async function markAllNotificationsRead(): Promise<
  { success: true; count: number } | { success: false; error: string }
> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_all_notifications_read");
  if (error) return { success: false, error: "既読にできませんでした。" };
  revalidatePath("/stylist/mypage");
  revalidatePath("/salon/mypage");
  return { success: true, count: data ?? 0 };
}
