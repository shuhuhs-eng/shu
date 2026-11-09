import { timingSafeEqual } from "node:crypto";

/**
 * cronエンドポイントの認証（`Authorization: Bearer <CRON_SECRET>`）。
 *   ・CRON_SECRET が未設定 → "not_configured"（実行しない）
 *   ・一致しない / ヘッダが無い → "unauthorized"
 * 定数時間で比較する（長さが違う場合は不一致）。
 */
export type CronAuthResult = "ok" | "not_configured" | "unauthorized";

export function verifyCronAuth(
  authHeader: string | null,
  secret: string | undefined = process.env.CRON_SECRET,
): CronAuthResult {
  if (!secret || !secret.trim()) return "not_configured";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(authHeader ?? "");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "unauthorized";
  return "ok";
}
