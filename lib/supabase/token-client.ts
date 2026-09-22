import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * 事前に取得済みのアクセストークン（文字列）だけを使って、Supabaseクライアントを作る。
 *
 * `lib/supabase/server.ts` の `createClient()` は `@supabase/ssr` の
 * `createServerClient` を使っており、内部で `next/headers` の `cookies()`
 * （リクエストスコープAPI）に依存する。これは `after()` のコールバック内
 * では呼び出せない（Next.jsの制約：レスポンス送信後はリクエストコンテキストが
 * 失われているため）。
 *
 * このクライアントは `cookies()` を一切使わず、`Authorization: Bearer <token>`
 * ヘッダーを直接付与するだけの素の `@supabase/supabase-js` クライアントである。
 * トークンは呼び出し前（リクエストコンテキストがまだ生きている間）に
 * 文字列として取得しておき、それをそのまま渡す想定。
 *
 * `set_diagnosis_ai_status` / `create_ai_output` / `activate_ai_output` 等、
 * `auth.uid()` で所有権を確認するSECURITY DEFINER RPCは、この方式であれば
 * 変更無しにそのまま呼び出せる（PostgRESTがヘッダーのJWTから`auth.uid()`を
 * 正しく解決するため。service roleクライアントでは`auth.uid()`が無く、
 * これらのRPCは呼び出せない点に注意）。
 */
export function createTokenClient(accessToken: string) {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
