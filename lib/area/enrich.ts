import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getStoreScouts } from "@/lib/store-activity/actions";
import { AVATAR_SIGNED_URL_EXPIRES_IN } from "@/lib/storage/avatar";

export type LatestScoutLite = { response_status: string; responded_at: string | null; response_message: string | null };

/** 候補(美容師)の表示補助: プロフィール画像の署名付きURLと、直近のスカウト回答状況。ページの初回表示と「さらに表示」で同じ処理を使う。 */
export async function enrichCandidates(storeId: string, items: { stylist_user_id: string; avatar_path?: string | null }[]) {
  const supabase = await createClient();
  const avatarUrls: Record<string, string> = {};
  const entries = items.filter((s) => s.avatar_path).map((s) => ({ id: s.stylist_user_id, path: s.avatar_path as string }));
  if (entries.length > 0) {
    const { data: signed } = await supabase.storage.from("avatars").createSignedUrls(entries.map((e) => e.path), AVATAR_SIGNED_URL_EXPIRES_IN);
    for (const row of signed ?? []) {
      const e = entries.find((x) => x.path === row.path);
      if (e && row.signedUrl && !row.error) avatarUrls[e.id] = row.signedUrl;
    }
  }
  const latestScouts: Record<string, LatestScoutLite> = {};
  for (const s of (await getStoreScouts(storeId)) ?? []) {
    if (!latestScouts[s.stylist_user_id]) latestScouts[s.stylist_user_id] = { response_status: s.response_status, responded_at: s.responded_at, response_message: s.response_message };
  }
  return { avatarUrls, latestScouts };
}
