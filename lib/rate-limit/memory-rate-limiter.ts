/**
 * インメモリのレート制限。
 *
 * ★重要な制約: このMapはNode.jsプロセスのメモリ上にのみ存在する。
 * 単一プロセスで動く開発環境・自前ホスティング（`next start`）では機能するが、
 * サーバーレス環境（Vercel等）で複数インスタンスに分散される構成では
 * インスタンスごとに別々のカウントになり、実効的な制限にならない。
 * 本番でサーバーレス運用する場合は、Upstash Redis・Vercel KV等の
 * 共有ストアに置き換えること（`check()`のシグネチャはそのまま流用できる想定）。
 *
 * 現状はMVPとして、単一プロセス内での連続送信の抑止・簡易的な悪用対策として使う。
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** 呼び出しのたびに期限切れエントリを間引く（無制限なメモリ増加を防ぐ簡易対策）。 */
function sweepExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

/**
 * key（例: "ip:1.2.3.4" や "email:foo@example.com"）ごとに、windowMs時間内の
 * リクエスト数が limit を超えていないか確認する。呼び出しごとにカウントを+1する
 * （allowedかどうかに関わらず、まず判定してからカウントする設計ではなく、
 * 許可された呼び出しのみをカウントする設計＝拒否された呼び出しは次回の判定に
 * 影響しない）。
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  if (buckets.size > 5000) sweepExpired(now); // 簡易的なメモリ上限対策

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** リクエストからクライアントIPを取り出す（プロキシ/CDN経由を想定しx-forwarded-forを優先）。 */
export function getClientIp(request: Request): string {
  return getClientIpFromHeaders(request.headers);
}

/** Server Action など Request が無い場所から使う版（next/headers の headers() を渡す）。 */
export function getClientIpFromHeaders(h: { get(name: string): string | null }): string {
  // ホスティング側が付け替える（クライアントが偽装できない）ヘッダを優先する。
  //   Vercel: x-vercel-forwarded-for（Vercelが上書き）→ x-real-ip
  // それが無い環境（自前ホスティング・開発）は x-forwarded-for の先頭を使う。
  // ★前段のプロキシが x-forwarded-for を上書きしない構成では偽装できるため、本番はVercel等の
  //   信頼できる前段を使うこと（docs/phase54 参照）。
  const vercel = h.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]!.trim();
  const realIp = h.get("x-real-ip");
  if (realIp) return realIp.trim();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]!.trim();
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// 予約ID方式の枠（DBが使えないときの縮退用。DB側 0055 と同じ規則を、このプロセス内だけで再現する）
// ---------------------------------------------------------------------------
// 1要求=1件。状態は pending → confirmed / released の一方向のみ。使用数は件の状態から数える（加減算しない）。
// 確定・返却は pending の件にだけ効くので、二重実行・確定後の返却・期限後の遅延返却でカウントは壊れない。
export type SlotOutcome = "confirm" | "release";
export type SlotLimits = { confirmedLimit: number; inflightLimit: number; windowMs: number; pendingTtlMs: number };
export type SlotResult =
  | { allowed: true; settle: (outcome: SlotOutcome) => boolean }
  | { allowed: false; reason: "limit" | "busy"; retryAfterSeconds: number };

type Slot = { windowStart: number; state: "pending" | "confirmed" | "released"; expiresAt: number };
const slots = new Map<string, Slot[]>();

export function reserveMemorySlot(key: string, limits: SlotLimits, now: number = Date.now()): SlotResult {
  const windowStart = Math.floor(now / limits.windowMs) * limits.windowMs;
  const windowEnd = windowStart + limits.windowMs;
  if (slots.size > 5000) {
    for (const [k, list] of slots) if (list.every((x) => x.windowStart < windowStart - limits.windowMs)) slots.delete(k);
  }
  // 古いウィンドウの件は回収する（現在のウィンドウの判定には使わない）。
  const list = (slots.get(key) ?? []).filter((x) => x.windowStart >= windowStart - limits.windowMs);
  slots.set(key, list);
  const mine = list.filter((x) => x.windowStart === windowStart);
  const confirmed = mine.filter((x) => x.state === "confirmed").length;
  const pending = mine.filter((x) => x.state === "pending" && x.expiresAt > now).length;
  if (confirmed >= limits.confirmedLimit) {
    return { allowed: false, reason: "limit", retryAfterSeconds: Math.max(1, Math.ceil((windowEnd - now) / 1000)) };
  }
  if (pending >= limits.inflightLimit) {
    return { allowed: false, reason: "busy", retryAfterSeconds: Math.min(5, Math.ceil(limits.pendingTtlMs / 1000)) };
  }
  const slot: Slot = { windowStart, state: "pending", expiresAt: now + limits.pendingTtlMs };
  list.push(slot);
  return {
    allowed: true,
    settle: (outcome) => {
      if (slot.state !== "pending") return false;
      slot.state = outcome === "confirm" ? "confirmed" : "released";
      return true;
    },
  };
}
