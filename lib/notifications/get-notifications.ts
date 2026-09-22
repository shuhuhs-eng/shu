import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

/**
 * マイページ上部の通知ベル用に、直近の通知一覧と未読件数を取得する。
 * 未読件数は一覧の件数上限（30件）に依存せず、常にDBの現在値を別クエリで
 * 正確に数える（一覧だけから数えると、31件目以降の未読を見落とすため）。
 */
export async function getNotificationsForBell(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ notifications: NotificationRow[]; unreadCount: number }> {
  const [{ data: notifications }, { count }] = await Promise.all([
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_read", false),
  ]);
  return { notifications: notifications ?? [], unreadCount: count ?? 0 };
}

export type UnreadNotificationRef = Pick<NotificationRow, "related_entity_type" | "related_entity_id">;

/**
 * サロン別/美容師別のカード単位バッジ用。未読通知の(related_entity_type,
 * related_entity_id)だけを、件数上限なしで全件取得する。バッジの計算は
 * 30件キャップの一覧に依存すると取りこぼすため、専用に分けている。
 */
export async function getUnreadNotificationRefs(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<UnreadNotificationRef[]> {
  const { data } = await supabase
    .from("notifications")
    .select("related_entity_type, related_entity_id")
    .eq("user_id", userId)
    .eq("is_read", false);
  return data ?? [];
}
