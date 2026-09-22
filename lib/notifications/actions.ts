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

const entitiesSchema = z.array(z.object({ type: z.string().min(1), id: z.string().uuid() })).min(1);

// カード単位の既読化（例: サロンカード1枚だけ既読にする）。他社/他の美容師の
// 未読には一切触れない（mark_notifications_read_by_entities側でauth.uid()と
// 渡されたtype+idの組に厳密一致するものだけをUPDATEする）。
export async function markNotificationsReadForEntities(
  entities: { type: string; id: string }[],
): Promise<{ success: true; count: number } | { success: false; error: string }> {
  const parsed = entitiesSchema.safeParse(entities);
  if (!parsed.success) return { success: false, error: "通知を確認できませんでした。" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_notifications_read_by_entities", {
    p_entities: parsed.data,
  });
  if (error) return { success: false, error: "既読にできませんでした。" };
  revalidatePath("/stylist/mypage");
  revalidatePath("/salon/mypage");
  return { success: true, count: data ?? 0 };
}
