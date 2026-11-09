import { createHash } from "node:crypto";
import { checkRateLimit, type RateLimitResult } from "./memory-rate-limiter";

/**
 * 共有レート制限（DBベース。Vercel等のサーバーレスで複数インスタンスに分かれても、同じカウンターを見る）。
 *
 *   ・実体は 0053 の check_rate_limit()（固定ウィンドウ。service_role専用）。
 *   ・キーはSHA-256にしてから送る（IP・メールアドレスの生値をDBへ保存しない）。
 *   ・DBへ到達できない・RPCが失敗した場合は、同じプロセス内のメモリ制限へ縮退する（ログに残す）。
 *     「無制限」にはしない（縮退してもインスタンス単位では制限が効く）。
 */
export function hashRateLimitKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export type SharedRateLimitDeps = {
  rpc?: (fn: "check_rate_limit", args: { p_key_hash: string; p_limit: number; p_window_seconds: number }) => Promise<{
    data: { allowed: boolean; retry_after_seconds: number }[] | { allowed: boolean; retry_after_seconds: number } | null;
    error: { message: string } | null;
  }>;
};

export async function checkSharedRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  deps: SharedRateLimitDeps = {},
): Promise<RateLimitResult> {
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  try {
    const rpc =
      deps.rpc ??
      (async (fn, args) => {
        // service role は server-only。テストでrpcを差し替える場合は読み込まない。
        const { createServiceClient } = await import("@/lib/supabase/service");
        const admin = createServiceClient();
        return (await admin.rpc(fn, args)) as unknown as Awaited<ReturnType<NonNullable<SharedRateLimitDeps["rpc"]>>>;
      });
    const { data, error } = await rpc("check_rate_limit", {
      p_key_hash: hashRateLimitKey(key),
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== "boolean") throw new Error("unexpected rate limit response");
    return { allowed: row.allowed, retryAfterSeconds: row.allowed ? 0 : Math.max(1, row.retry_after_seconds) };
  } catch (e) {
    console.error("[rate-limit] shared limiter unavailable; falling back to in-memory", {
      message: e instanceof Error ? e.message : "unknown",
    });
    return checkRateLimit(key, limit, windowMs);
  }
}
