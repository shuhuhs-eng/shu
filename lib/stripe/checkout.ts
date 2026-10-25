import "server-only";
import { buildMonthlySessionParams, buildScoutCreditSessionParams, buildSuccessFeeSessionParams } from "./session-params";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import type { Database, StripeBeginResult } from "@/types/database";
import { buildReturnUrl, type ReturnKind } from "./config";
import { currentStripeLivemode, getStripe } from "./client";

/**
 * Stripe Checkout / Customer Portal の開始（サーバー専用）。
 *
 * ★金額・対象組織・成功報酬はクライアントを信用しない:
 *   begin_* RPC（DB）が権限確認のうえ「期待金額」を確定し、その値だけをStripeへ渡す。
 *   ブラウザから渡るのは organizationId / feeId / packageId という“どれを対象にするか”のIDのみで、
 *   それが本人の会社のものかどうかはRPCが再検証する。
 * ★Checkout Sessionの作成にはレコードID由来の冪等キーを使い、同じ決済の二重作成を防ぐ。
 * ★payment_method_types は指定しない（Stripe API 2026-09-30.endive で廃止）。
 */
type Supa = SupabaseClient<Database>;
type Rpc = { message: string };

function fail(error: Rpc | null | undefined, fallback: string): never {
  throw new Error(error?.message || fallback);
}

function siteUrl(): string {
  const u = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!u) throw new Error("stripe not configured: missing_site_url");
  return u;
}

/** 1 organization = 1 Stripe Customer。無ければ作成して登録する（冪等）。 */
export async function ensureStripeCustomer(supabase: Supa, organizationId: string): Promise<string> {
  const livemode = currentStripeLivemode();
  const { data: existing, error } = await supabase.rpc("get_organization_stripe_customer", { p_organization_id: organizationId });
  if (error || !existing) fail(error, "customer lookup failed");
  if (existing.stripe_customer_id) {
    if (existing.livemode !== livemode) throw new Error("mode mismatch");
    return existing.stripe_customer_id;
  }
  const stripe = getStripe();
  const customer = await stripe.customers.create(
    {
      name: existing.organization_name ?? undefined,
      metadata: { beauty_reach_organization_id: organizationId },
    },
    { idempotencyKey: `br-customer-${organizationId}-${livemode ? "live" : "test"}` },
  );
  const { data: reg, error: regError } = await supabase.rpc("register_stripe_customer", {
    p_organization_id: organizationId, p_stripe_customer_id: customer.id, p_livemode: livemode,
  });
  if (regError || !reg) fail(regError, "customer registration failed");
  return reg.stripe_customer_id;
}

type SessionParams = Stripe.Checkout.SessionCreateParams;

/** 既存の有効なSessionがあれば再利用、無ければ作成してレコードに紐付ける。 */
async function openSession(
  supabase: Supa, begin: StripeBeginResult, kind: ReturnKind, build: () => SessionParams,
): Promise<string> {
  const stripe = getStripe();
  if (begin.reuse_stripe_session_id) {
    const existing = await stripe.checkout.sessions.retrieve(begin.reuse_stripe_session_id);
    if (existing.status === "open" && existing.url) return existing.url;
    throw new Error("checkout already completed");
  }
  const site = siteUrl();
  const session = await stripe.checkout.sessions.create(
    {
      ...build(),
      customer: begin.stripe_customer_id,
      locale: "ja",
      expires_at: Math.floor(new Date(begin.expires_at).getTime() / 1000),
      success_url: buildReturnUrl(site, { stripe: "success", kind }),
      cancel_url: buildReturnUrl(site, { stripe: "cancel", kind }),
    },
    { idempotencyKey: `br-chk-${begin.record_id}` },
  );
  const { error } = await supabase.rpc("attach_stripe_checkout_session", {
    p_record_id: begin.record_id, p_stripe_session_id: session.id,
  });
  if (error) fail(error, "attach failed");
  if (!session.url) throw new Error("checkout session has no url");
  return session.url;
}

export async function startPaymentMethodSetup(supabase: Supa, organizationId: string): Promise<string> {
  await ensureStripeCustomer(supabase, organizationId);
  const { data, error } = await supabase.rpc("begin_payment_method_setup", { p_organization_id: organizationId });
  if (error || !data) fail(error, "begin failed");
  return openSession(supabase, data, "card", () => ({
    mode: "setup",
    currency: "jpy",
    metadata: { checkout_record_id: data.record_id, purpose: "payment_method_setup" },
  }));
}

export async function startMonthlySubscription(supabase: Supa, organizationId: string): Promise<string> {
  await ensureStripeCustomer(supabase, organizationId);
  const { data, error } = await supabase.rpc("begin_monthly_subscription_checkout", { p_organization_id: organizationId });
  if (error || !data) fail(error, "begin failed");
  // 月額（税抜）は契約(organization_contract_settings.monthly_fee)の値。Stripeへは税込total_amountを渡す。
  return openSession(supabase, data, "subscription", () => buildMonthlySessionParams(data));
}

export async function startSuccessFeeCardPayment(supabase: Supa, organizationId: string, feeId: string): Promise<string> {
  await ensureStripeCustomer(supabase, organizationId);
  const { data, error } = await supabase.rpc("begin_success_fee_card_checkout", { p_fee_id: feeId });
  if (error || !data) fail(error, "begin failed");
  if (data.organization_id !== organizationId) throw new Error("organization not found or not accessible");
  return openSession(supabase, data, "success_fee", () => buildSuccessFeeSessionParams(data));
}

export async function startScoutCreditPurchase(supabase: Supa, organizationId: string, packageId: string): Promise<string> {
  await ensureStripeCustomer(supabase, organizationId);
  const { data, error } = await supabase.rpc("begin_scout_credit_checkout", { p_organization_id: organizationId, p_package_id: packageId });
  if (error || !data) fail(error, "begin failed");
  return openSession(supabase, data, "scout_credits", () => buildScoutCreditSessionParams(data));
}

/** Customer Portal（カード変更・Stripe側の請求履歴）。Beauty Reachの請求書が主で、これは補助。 */
export async function startCustomerPortal(supabase: Supa, organizationId: string): Promise<string> {
  const customerId = await ensureStripeCustomer(supabase, organizationId);
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: buildReturnUrl(siteUrl(), { stripe: "success", kind: "portal" }),
  });
  return session.url;
}

export type CardDisplay = { brand: string; last4: string; expMonth: number; expYear: number };

/**
 * 画面表示用のカード情報（ブランド・下4桁・有効期限）。Stripe APIから表示のたびに取得し、
 * Beauty Reach DBには保存しない。取得できなくても画面は壊さない（nullを返す）。
 */
export async function getDefaultCardDisplay(supabase: Supa, organizationId: string): Promise<CardDisplay | null> {
  try {
    const { data } = await supabase.rpc("get_organization_stripe_customer", { p_organization_id: organizationId });
    if (!data?.stripe_customer_id) return null;
    const customer = await getStripe().customers.retrieve(data.stripe_customer_id, {
      expand: ["invoice_settings.default_payment_method"],
    });
    if (customer.deleted) return null;
    const pm = customer.invoice_settings?.default_payment_method;
    if (!pm || typeof pm === "string" || !pm.card) return null;
    return { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year };
  } catch {
    return null;
  }
}
