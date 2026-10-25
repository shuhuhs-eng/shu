"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/security/log";
import { checkRateLimit } from "@/lib/rate-limit/memory-rate-limiter";
import { isAllowedStripeRedirect, mapStripeActionError } from "./errors";
import {
  startCustomerPortal, startMonthlySubscription, startPaymentMethodSetup,
  startScoutCreditPurchase, startSuccessFeeCardPayment,
} from "./checkout";

/**
 * 会社担当者(company_owner / company_admin)がStripeの決済画面へ進むためのServer Actions。
 * 戻り値はStripeホスティング画面のURLのみ。成功URLへ戻っても何も確定しない（webhookが正）。
 * 権限・金額・対象の所有は全てDB(RPC)が検証する。ここでは入力形式と回数制限だけを見る。
 */
export type StripeStartResult = { success: true; url: string } | { success: false; error: string };

const orgSchema = z.object({ organizationId: z.string().uuid() });

async function run(
  where: string,
  fn: (supabase: Awaited<ReturnType<typeof createClient>>) => Promise<string>,
): Promise<StripeStartResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "ログインが必要です。" };
  const limit = checkRateLimit(`stripe-start:${user.id}`, 10, 60_000);
  if (!limit.allowed) return { success: false, error: "操作が多すぎます。少し待ってからお試しください。" };
  try {
    const url = await fn(supabase);
    if (!isAllowedStripeRedirect(url)) {
      logError(`${where}: unexpected redirect target`);
      return { success: false, error: "処理を開始できませんでした。時間をおいて再度お試しください。" };
    }
    return { success: true, url };
  } catch (e) {
    logError(where, e); // message/code のみ。リクエスト内容・秘密鍵は出さない。
    return { success: false, error: mapStripeActionError(e instanceof Error ? e.message : undefined) };
  }
}

export async function startCardRegistrationAction(input: z.input<typeof orgSchema>): Promise<StripeStartResult> {
  const p = orgSchema.safeParse(input);
  if (!p.success) return { success: false, error: "入力内容を確認してください。" };
  return run("startCardRegistration", (s) => startPaymentMethodSetup(s, p.data.organizationId));
}

export async function startMonthlySubscriptionAction(input: z.input<typeof orgSchema>): Promise<StripeStartResult> {
  const p = orgSchema.safeParse(input);
  if (!p.success) return { success: false, error: "入力内容を確認してください。" };
  return run("startMonthlySubscription", (s) => startMonthlySubscription(s, p.data.organizationId));
}

const feeSchema = z.object({ organizationId: z.string().uuid(), feeId: z.string().uuid() });
export async function startSuccessFeeCardPaymentAction(input: z.input<typeof feeSchema>): Promise<StripeStartResult> {
  const p = feeSchema.safeParse(input);
  if (!p.success) return { success: false, error: "入力内容を確認してください。" };
  return run("startSuccessFeeCardPayment", (s) => startSuccessFeeCardPayment(s, p.data.organizationId, p.data.feeId));
}

const packageSchema = z.object({ organizationId: z.string().uuid(), packageId: z.string().uuid() });
export async function startScoutCreditPurchaseAction(input: z.input<typeof packageSchema>): Promise<StripeStartResult> {
  const p = packageSchema.safeParse(input);
  if (!p.success) return { success: false, error: "入力内容を確認してください。" };
  return run("startScoutCreditPurchase", (s) => startScoutCreditPurchase(s, p.data.organizationId, p.data.packageId));
}

export async function openCustomerPortalAction(input: z.input<typeof orgSchema>): Promise<StripeStartResult> {
  const p = orgSchema.safeParse(input);
  if (!p.success) return { success: false, error: "入力内容を確認してください。" };
  return run("openCustomerPortal", (s) => startCustomerPortal(s, p.data.organizationId));
}
