"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { capArrayInput } from "@/lib/validation/bounded-array";

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
  revalidatePath("/"); // トップ画面の通知ベルの未読件数も合わせる
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
  revalidatePath("/"); // トップ画面の通知ベルの未読件数も合わせる
  return { success: true, count: data ?? 0 };
}

// 1カード分の通知の組。正規の画面が送る件数より十分大きい上限を、要素の検証前に確認する（巨大配列によるメモリ枯渇の防止）。
const MAX_NOTIFICATION_ENTITIES = 200;
const entitiesSchema = capArrayInput(MAX_NOTIFICATION_ENTITIES, z.array(z.object({ type: z.string().min(1), id: z.string().uuid() })).min(1).max(MAX_NOTIFICATION_ENTITIES));

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
  revalidatePath("/"); // トップ画面の通知ベルの未読件数も合わせる
  return { success: true, count: data ?? 0 };
}
