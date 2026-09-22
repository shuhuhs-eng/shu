import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

/**
 * クライアントコンポーネント用。公開しても安全な anon キーのみを使用。
 * service role キーやAI APIキーはここには絶対に持ち込まない。
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
