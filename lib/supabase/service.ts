import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * service role キーを使うSupabaseクライアント。
 *
 * 用途は限定的: pending_diagnoses への書き込み（未ログイン診断の一時保存）など、
 * RLSに保護されたユーザーコンテキストが無い場面でのみ使用する。
 * このクライアントはRLSを完全にバイパスするため、
 *   ・ブラウザへ絶対に渡さない（Route Handler / Server Action の中でのみ生成する）
 *   ・書き込み先・書き込み内容は呼び出し側で厳密に検証してから使う
 * ことを徹底する。SUPABASE_SERVICE_ROLE_KEY は NEXT_PUBLIC_ を付けておらず、
 * クライアントバンドルには含まれない。
 */
export function createServiceClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
