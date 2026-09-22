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
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]!.trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
