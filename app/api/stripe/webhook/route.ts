import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/client";
import { checkStripeWebhookEnv } from "@/lib/stripe/config";
import { processStripeEvent, type CallRpc, type StripeApi } from "@/lib/stripe/webhook-handler";
import { createServiceClient } from "@/lib/supabase/service";
import { issueSubscriptionInvoiceAsSystem } from "@/lib/invoices/subscription-issue";
import { logError } from "@/lib/security/log";

/**
 * Stripe webhook受信（/api/stripe/webhook）。
 *
 * ★署名検証: 生のリクエストbody(text)を加工せずに stripe.webhooks.constructEvent へ渡す（許容誤差は
 *   SDK既定の5分。0にしない）。検証に失敗したら何も処理しない。
 * ★冪等性: event.id を claim_stripe_webhook_event で先に確保する。処理済みの再送は200で即応答、
 *   処理中の同時配信は409（Stripeが後で再送）。失敗した場合は500を返してStripeに再送させる。
 * ★ログ: 署名・生payload・カード/顧客情報は出さない（event id・type・結果コードのみ）。
 * ★このRouteは認証cookieを使わない外部からのPOST。DB更新はservice_roleだけが実行できるRPC経由。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  const env = checkStripeWebhookEnv(process.env);
  if (!env.ok) {
    logError("stripeWebhook: not configured", { message: env.reason });
    return json(503, { error: "webhook not configured" });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return json(400, { error: "missing signature" });

  const rawBody = await request.text();
  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!.trim());
  } catch {
    return json(400, { error: "invalid signature" });
  }

  const supabase = createServiceClient();
  const { data: claim, error: claimError } = await supabase.rpc("claim_stripe_webhook_event", {
    p_event_id: event.id, p_event_type: event.type, p_livemode: event.livemode,
  });
  if (claimError) {
    logError("stripeWebhook: claim failed", claimError);
    return json(500, { error: "claim failed" });
  }
  if (claim === "duplicate") return json(200, { received: true, duplicate: true });
  if (claim === "in_progress") return json(409, { error: "in progress" });

  const callRpc: CallRpc = async (fn, args) => {
    // 型は CallRpc が保証する。supabase-js のジェネリクスを通すため一度だけ緩める。
    const { data, error } = await (supabase.rpc as unknown as (f: string, a: unknown) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>)(fn, args);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return data as never;
  };
  const stripeApi: StripeApi = {
    async setupIntentPaymentMethod(id) {
      const si = await stripe.setupIntents.retrieve(id);
      return typeof si.payment_method === "string" ? si.payment_method : (si.payment_method?.id ?? null);
    },
    retrieveSubscription: (id) => stripe.subscriptions.retrieve(id),
    retrieveInvoice: (id) => stripe.invoices.retrieve(id, { expand: ["payments"] }),
    async setCustomerDefaultPaymentMethod(customerId, pm) {
      await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm } });
    },
    async listCustomerCardPaymentMethods(customerId) {
      const list = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 10 });
      return list.data.map((p) => p.id);
    },
  };

  try {
    const outcome = await processStripeEvent(event, {
      callRpc, stripe: stripeApi, now: () => new Date(), expectedLivemode: env.livemode,
      // 月額の適格請求書PDF。失敗しても支払記録は確定済み（未発行として運営画面に出る）。
      issueSubscriptionInvoice: async (paymentId) => {
        const r = await issueSubscriptionInvoiceAsSystem(paymentId);
        if (r.status === "failed") logError("stripeWebhook: subscription invoice pdf not issued", { message: r.reason });
      },
    });
    await supabase.rpc("complete_stripe_webhook_event", {
      p_event_id: event.id, p_result: outcome.result, p_error_code: outcome.note ?? null,
    });
    return json(200, { received: true, result: outcome.result });
  } catch (e) {
    logError(`stripeWebhook: processing failed (${event.type})`, e);
    await supabase.rpc("complete_stripe_webhook_event", {
      p_event_id: event.id, p_result: "failed", p_error_code: "handler_error",
    });
    return json(500, { error: "processing failed" });
  }
}
