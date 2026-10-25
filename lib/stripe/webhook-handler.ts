import type Stripe from "stripe";
import type { Database } from "@/types/database";

/**
 * Stripe webhookイベントの業務処理（純粋なロジック。Stripe APIとDB RPCは依存注入で受け取るため、
 * 本物のStripe/DBなしでテストできる）。
 *
 * ★原則:
 *   ・DBの状態はこのハンドラ経由のRPC（service_roleのみ実行可）でしか更新しない。success URLへの
 *     到達では何も更新しない。
 *   ・組織の特定にmetadataのorganization_idは使わない。DBに保存したcheckout_record_id（DBが
 *     期待金額・対象組織を持つ）とStripe Customer IDの対応で検証する（検証はRPC側）。
 *   ・Subscriptionは通知内容ではなくStripe APIで取得した最新オブジェクトを反映する
 *     （イベントの到着順は保証されないため）。
 *   ・例外を投げた場合は呼び出し側が500を返し、Stripeが再送する（RPCは全て冪等）。
 */
type Functions = Database["public"]["Functions"];
export type ApplyFnName =
  | "apply_payment_method_setup" | "set_payment_method_state" | "apply_subscription_checkout_completed"
  | "apply_stripe_subscription_snapshot" | "apply_stripe_invoice_result" | "mark_stripe_checkout_expired"
  | "apply_success_fee_card_payment" | "apply_scout_credit_payment" | "record_stripe_refund_or_dispute";

export type CallRpc = <T extends ApplyFnName>(fn: T, args: Functions[T]["Args"]) => Promise<Functions[T]["Returns"]>;

export type StripeApi = {
  setupIntentPaymentMethod(setupIntentId: string): Promise<string | null>;
  retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription>;
  setCustomerDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void>;
  listCustomerCardPaymentMethods(customerId: string): Promise<string[]>;
};

export type HandlerDeps = { callRpc: CallRpc; stripe: StripeApi; now: () => Date; expectedLivemode: boolean };
export type HandlerOutcome = { result: "processed" | "ignored" | "integrity_issue"; note?: string };

/** 購読するイベント（Stripeダッシュボードのwebhook設定にはこの一覧だけを登録する）。 */
export const HANDLED_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "payment_method.detached",
  "charge.refunded",
  "charge.dispute.created",
] as const;

export function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

const iso = (unix: number | null | undefined): string | null => (typeof unix === "number" ? new Date(unix * 1000).toISOString() : null);

/** Subscriptionの代表Item（本サービスは月額1品目のみ）から期間・金額を取り出す。 */
export function subscriptionFacts(sub: Stripe.Subscription) {
  const item = sub.items.data[0];
  const unit = item?.price?.unit_amount ?? null;
  const qty = item?.quantity ?? 1;
  return {
    periodStart: iso(item?.current_period_start),
    periodEnd: iso(item?.current_period_end),
    amount: unit === null ? null : unit * qty,
    currency: item?.price?.currency ?? "",
  };
}

const isOurSubscription = (sub: Stripe.Subscription) => sub.metadata?.beauty_reach_purpose === "monthly_subscription";

async function applySubscription(deps: HandlerDeps, sub: Stripe.Subscription, eventId: string): Promise<string> {
  const customerId = idOf(sub.customer);
  if (!customerId) return "ignored";
  const facts = subscriptionFacts(sub);
  const r = await deps.callRpc("apply_stripe_subscription_snapshot", {
    p_customer_id: customerId,
    p_subscription_id: sub.id,
    p_status: sub.status,
    p_period_start: facts.periodStart,
    p_period_end: facts.periodEnd,
    p_cancel_at_period_end: sub.cancel_at_period_end,
    p_amount: facts.amount,
    p_currency: facts.currency,
    p_retrieved_at: deps.now().toISOString(),
    p_event_id: eventId,
  });
  return r.result;
}

const worst = (results: string[]): HandlerOutcome["result"] =>
  results.includes("integrity_issue") ? "integrity_issue" : results.every((r) => r === "ignored") ? "ignored" : "processed";

export async function processStripeEvent(event: Stripe.Event, deps: HandlerDeps): Promise<HandlerOutcome> {
  if (event.livemode !== deps.expectedLivemode) return { result: "ignored", note: "livemode_mismatch" };

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return handleCheckoutCompleted(event.data.object, event.id, deps);

    case "checkout.session.expired": {
      const s = event.data.object;
      const recordId = s.metadata?.checkout_record_id;
      if (!recordId) return { result: "ignored" };
      await deps.callRpc("mark_stripe_checkout_expired", { p_checkout_record_id: recordId, p_session_id: s.id });
      return { result: "processed" };
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      if (!isOurSubscription(event.data.object)) return { result: "ignored", note: "not_monthly_subscription" };
      // 通知内容ではなく最新オブジェクトを取得して反映する。
      const latest = await deps.stripe.retrieveSubscription(event.data.object.id);
      return { result: worst([await applySubscription(deps, latest, event.id)]) };
    }

    case "invoice.paid":
    case "invoice.payment_failed": {
      const inv = event.data.object;
      const subId = idOf(inv.parent?.subscription_details?.subscription ?? null);
      const customerId = idOf(inv.customer);
      if (!subId || !customerId) return { result: "ignored", note: "not_subscription_invoice" };
      const latest = await deps.stripe.retrieveSubscription(subId);
      if (!isOurSubscription(latest)) return { result: "ignored", note: "not_monthly_subscription" };
      const snap = await applySubscription(deps, latest, event.id);
      const r = await deps.callRpc("apply_stripe_invoice_result", {
        p_customer_id: customerId,
        p_subscription_id: subId,
        p_result: event.type === "invoice.paid" ? "succeeded" : "failed",
        p_event_at: new Date(event.created * 1000).toISOString(),
        p_event_id: event.id,
      });
      return { result: worst([snap, r.result]) };
    }

    case "payment_method.detached": {
      const prevCustomer = (event.data.previous_attributes as { customer?: string } | undefined)?.customer ?? null;
      if (!prevCustomer) return { result: "ignored" };
      const remaining = await deps.stripe.listCustomerCardPaymentMethods(prevCustomer);
      const r = await deps.callRpc("set_payment_method_state", {
        p_customer_id: prevCustomer,
        p_available: remaining.length > 0,
        p_payment_method_id: remaining[0] ?? null,
        p_event_id: event.id,
      });
      return { result: worst([r.result]) };
    }

    case "charge.refunded": {
      const pi = idOf(event.data.object.payment_intent);
      if (!pi) return { result: "ignored" };
      const r = await deps.callRpc("record_stripe_refund_or_dispute", { p_payment_intent_id: pi, p_event_id: event.id, p_kind: "refund" });
      return { result: r.result === "recorded" ? "integrity_issue" : "ignored" };
    }

    case "charge.dispute.created": {
      const pi = idOf(event.data.object.payment_intent);
      if (!pi) return { result: "ignored" };
      const r = await deps.callRpc("record_stripe_refund_or_dispute", { p_payment_intent_id: pi, p_event_id: event.id, p_kind: "dispute" });
      return { result: r.result === "recorded" ? "integrity_issue" : "ignored" };
    }

    default:
      return { result: "ignored", note: "unhandled_type" };
  }
}

async function handleCheckoutCompleted(s: Stripe.Checkout.Session, eventId: string, deps: HandlerDeps): Promise<HandlerOutcome> {
  const recordId = s.metadata?.checkout_record_id;
  const purpose = s.metadata?.purpose;
  const customerId = idOf(s.customer);
  if (!recordId || !purpose || !customerId) return { result: "ignored", note: "not_ours" };

  if (purpose === "payment_method_setup") {
    const pm = s.setup_intent ? await deps.stripe.setupIntentPaymentMethod(idOf(s.setup_intent)!) : null;
    const r = await deps.callRpc("apply_payment_method_setup", {
      p_checkout_record_id: recordId, p_session_id: s.id, p_customer_id: customerId,
      p_payment_method_id: pm, p_session_status: s.status ?? "", p_event_id: eventId,
    });
    // 再送で再実行されても同じ結果になるよう、適用済みでもStripe側の既定カードを揃える。
    if ((r.result === "applied" || r.result === "already_applied") && pm) {
      await deps.stripe.setCustomerDefaultPaymentMethod(customerId, pm);
    }
    return { result: worst([r.result]) };
  }

  if (purpose === "monthly_subscription") {
    const subId = idOf(s.subscription);
    const r = await deps.callRpc("apply_subscription_checkout_completed", {
      p_checkout_record_id: recordId, p_session_id: s.id, p_customer_id: customerId,
      p_session_status: s.status ?? "", p_event_id: eventId,
    });
    const results = [r.result];
    if ((r.result === "applied" || r.result === "already_applied") && subId) {
      const sub = await deps.stripe.retrieveSubscription(subId);
      results.push(await applySubscription(deps, sub, eventId));
      const pm = idOf(sub.default_payment_method);
      if (pm) {
        const st = await deps.callRpc("set_payment_method_state", {
          p_customer_id: customerId, p_available: true, p_payment_method_id: pm, p_event_id: eventId,
        });
        results.push(st.result);
        await deps.stripe.setCustomerDefaultPaymentMethod(customerId, pm);
      }
    }
    return { result: worst(results) };
  }

  if (purpose === "success_fee" || purpose === "scout_credits") {
    const fn = purpose === "success_fee" ? "apply_success_fee_card_payment" : "apply_scout_credit_payment";
    const r = await deps.callRpc(fn, {
      p_checkout_record_id: recordId, p_session_id: s.id, p_customer_id: customerId,
      p_payment_intent_id: idOf(s.payment_intent), p_amount_total: s.amount_total ?? null,
      p_currency: s.currency ?? "", p_payment_status: s.payment_status, p_event_id: eventId,
    });
    return { result: r.result === "integrity_issue" ? "integrity_issue" : r.result === "not_paid" ? "ignored" : "processed", note: r.result };
  }

  return { result: "ignored", note: "unknown_purpose" };
}
