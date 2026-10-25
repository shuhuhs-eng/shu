import "server-only";
import Stripe from "stripe";
import { checkStripeEnv } from "./config";

let cached: Stripe | null = null;

/**
 * Stripe APIクライアント（サーバー専用）。
 * ・APIバージョンは固定しない指定ではなく、stripe SDK 23.0.1（package.jsonで完全固定）が
 *   同梱する 2026-09-30.endive を使う。SDKを上げない限りAPIバージョンは変わらない。
 * ・payment_method_types は一切指定しない（endiveで廃止）。支払い方法はStripeダッシュボードの
 *   動的支払い方法で管理し、カード以外を許可するかは運営がダッシュボードで決める。
 * ・秘密鍵・リクエスト内容はログに出さない。
 */
export function getStripe(): Stripe {
  const check = checkStripeEnv(process.env);
  if (!check.ok) throw new StripeNotConfiguredError(check.reason);
  if (!cached) {
    cached = new Stripe(process.env.STRIPE_SECRET_KEY!.trim(), {
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: "Beauty Reach" },
    });
  }
  return cached;
}

export class StripeNotConfiguredError extends Error {
  constructor(public readonly reason: string) {
    super(`stripe not configured: ${reason}`);
  }
}

export function currentStripeLivemode(): boolean {
  const check = checkStripeEnv(process.env);
  if (!check.ok) throw new StripeNotConfiguredError(check.reason);
  return check.livemode;
}
