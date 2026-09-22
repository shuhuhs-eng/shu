import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/** 署名付きURLの有効期限（秒）。1時間。 */
export const AVATAR_SIGNED_URL_EXPIRES_IN = 60 * 60;

/**
 * avatarsバケット（非公開）内のパスから、期限付きの署名付きURLを発行する。
 * DBにはこのURLではなく avatar_path（パスのみ）を保存し、表示するたびに
 * この関数で都度発行する。呼び出し元の認可（本人のフォルダかどうか）は
 * Storage RLS（avatars_select_own）が担保する。
 */
export async function getAvatarSignedUrl(
  supabase: SupabaseClient<Database>,
  path: string | null,
): Promise<string | null> {
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from("avatars")
    .createSignedUrl(path, AVATAR_SIGNED_URL_EXPIRES_IN);

  if (error || !data) return null;
  return data.signedUrl;
}
