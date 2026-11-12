import { createHash } from "node:crypto";
import {
  checkRateLimit,
  reserveMemorySlot,
  type RateLimitResult,
  type SlotLimits,
  type SlotOutcome,
} from "./memory-rate-limiter";

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

// ---------------------------------------------------------------------------
// 予約ID方式の枠（reserveSlot）
// ---------------------------------------------------------------------------
// 「検証中の予約（pending）→ 結果が分かったら確定（confirm）または返却（release）」。
// 例: 新規登録のメール単位の枠。CAPTCHA検証はSupabase Authが行うため、数える時点では未検証。
//   ・実体は 0055 の reserve_rate_limit_slot() / settle_rate_limit_slot()（service_role専用）。
//   ・1要求=1件（予約ID）。使用数は件の状態から数えるので、同じ返却を繰り返しても他の要求の枠は変わらない。
//   ・settle() は予約ごとに1回だけ送る。DB側も pending の件にだけ効く（二重の保険）。
//   ・settle が届かなかった（通信切断・プロセス終了・RPC失敗）pending は、期限（pendingTtlMs）で自動的に枠から外れる。
//   ・DBが使えない・0055が未適用の場合は、メモリの枠へ縮退する（ログに残す）。
export type SlotReservation =
  | { allowed: true; settle: (outcome: SlotOutcome) => Promise<void> }
  | { allowed: false; reason: "limit" | "busy"; retryAfterSeconds: number };

export type SlotDeps = {
  rpc?: (fn: "reserve_rate_limit_slot" | "settle_rate_limit_slot", args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
  /** メモリ縮退の時計（テスト用）。 */
  now?: () => number;
};

export async function reserveSlot(key: string, limits: SlotLimits, deps: SlotDeps = {}): Promise<SlotReservation> {
  const keyHash = hashRateLimitKey(key);
  const rpc =
    deps.rpc ??
    (async (fn, args) => {
      const { createServiceClient } = await import("@/lib/supabase/service");
      // 0055の関数はDB型定義（types/database.ts）にまだ無いため、型を介さず呼ぶ。
      const client = createServiceClient() as unknown as {
        rpc: (name: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
      };
      return await client.rpc(fn, args);
    });
  try {
    const { data, error } = await rpc("reserve_rate_limit_slot", {
      p_key_hash: keyHash,
      p_confirmed_limit: limits.confirmedLimit,
      p_inflight_limit: limits.inflightLimit,
      p_window_seconds: Math.max(1, Math.ceil(limits.windowMs / 1000)),
      p_pending_ttl_seconds: Math.max(1, Math.ceil(limits.pendingTtlMs / 1000)),
    });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as
      | { allowed: boolean; reservation_id: string | null; reason: string; retry_after_seconds: number }
      | null
      | undefined;
    if (!row || typeof row.allowed !== "boolean") throw new Error("unexpected rate limit response");
    if (!row.allowed) {
      return {
        allowed: false,
        reason: row.reason === "busy" ? "busy" : "limit",
        retryAfterSeconds: Math.max(1, row.retry_after_seconds),
      };
    }
    const reservationId = row.reservation_id;
    if (typeof reservationId !== "string") throw new Error("unexpected rate limit response");
    let settled = false;
    return {
      allowed: true,
      settle: async (outcome) => {
        if (settled) return;
        settled = true;
        // 失敗しても1回だけ再試行する。それでも届かなければ、pendingは期限で枠から外れる（制限が恒久的に残らない）。
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await rpc("settle_rate_limit_slot", { p_reservation_id: reservationId, p_outcome: outcome });
            if (res.error) throw new Error(res.error.message);
            return;
          } catch (e) {
            if (attempt === 1) console.error("[rate-limit] settle failed; reservation will expire", { outcome, message: e instanceof Error ? e.message : "unknown" });
          }
        }
      },
    };
  } catch (e) {
    console.error("[rate-limit] shared slot limiter unavailable; falling back to in-memory", {
      message: e instanceof Error ? e.message : "unknown",
    });
    const r = reserveMemorySlot(key, limits, deps.now?.());
    if (!r.allowed) return r;
    return { allowed: true, settle: async (outcome) => void r.settle(outcome) };
  }
}
