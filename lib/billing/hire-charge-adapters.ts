import type Stripe from "stripe";
import type { HireChargeDb, HireChargeStripe, IntentLite, ChargeInfo, DueRow, Recoverable, Fault } from "./hire-charge";

/** 実DB（service_role）とStripeをジョブ用の依存に包む。ロジックは hire-charge.ts（試験済み）。 */
export type RpcCaller = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export function makeHireChargeDb(rpc: RpcCaller): HireChargeDb {
  return {
    due: async (limit, after) => ((await rpc("service_hire_fee_due", { p_limit: limit, p_after_date: after?.key_date ?? null, p_after_id: after?.id ?? null })) as DueRow[]) ?? [],
    begin: async (id, livemode) => {
      try { return (await rpc("service_hire_fee_begin_charge", { p_schedule_id: id, p_expected_livemode: livemode })) as { attempt_id: string }; }
      catch (e) { const m = (e as Error).message; if (/not chargeable|card is not registered|retry date|charge date|livemode|maximum payment attempts|in progress|unknown/.test(m)) return { skipped: m.slice(0, 80) }; throw e; }
    },
    info: async (id) => (await rpc("service_hire_fee_charge_info", { p_attempt_id: id })) as ChargeInfo | null,
    markSent: async (id) => (await rpc("service_hire_fee_mark_sent", { p_attempt_id: id })) === true,
    record: async (id, result, ref) => { await rpc("service_hire_fee_record_result", { p_attempt_id: id, p_result: result, p_external_ref: ref }); },
    autoChargeEnabled: async () => (await rpc("service_hire_fee_auto_charge_enabled", {})) === true,
    recoverable: async (minAge, limit) => ((await rpc("service_hire_fee_recoverable", { p_min_age_minutes: minAge, p_limit: limit, p_retry_after_minutes: 30 })) as Recoverable[]) ?? [],
    applyFacts: async (a) => String(await rpc("service_hire_fee_apply_notification", {
      p_attempt_id: a.attemptId, p_result: a.result, p_payment_intent_id: a.paymentIntentId, p_event_id: a.eventId, p_amount: a.amount, p_currency: a.currency,
      p_customer_id: a.customerId, p_livemode: a.livemode, p_schedule_id: a.scheduleId ?? "", p_source: a.source,
    })),
  };
}

const customerId = (c: Stripe.PaymentIntent["customer"]) => (typeof c === "string" ? c : (c?.id ?? null));
export const intentLite = (pi: Stripe.PaymentIntent): IntentLite => ({
  paymentIntentId: pi.id, status: pi.status, amount: pi.amount, currency: pi.currency, customerId: customerId(pi.customer), livemode: pi.livemode,
  scheduleId: pi.metadata?.hire_fee_schedule_id ?? null,
});

export function makeHireChargeStripe(stripe: Stripe): HireChargeStripe {
  return {
    async charge(a) {
      try {
        const pi = await stripe.paymentIntents.create({
          amount: a.amountYen, currency: "jpy", customer: a.customerId, payment_method: a.paymentMethodId,
          off_session: true, confirm: true, metadata: a.metadata, description: "採用料（Beauty Reach）",
        }, { idempotencyKey: a.idempotencyKey });
        return intentLite(pi);
      } catch (e) {
        const err = e as { type?: string; payment_intent?: Stripe.PaymentIntent };
        if (err.type === "StripeCardError") return { declined: true, intent: err.payment_intent ? intentLite(err.payment_intent) : null };
        throw e;
      }
    },
    async findByAttempt(attemptId) {
      if (!/^[0-9a-f-]{36}$/i.test(attemptId)) throw new Error("invalid attempt id");
      const r = await stripe.paymentIntents.search({ query: `metadata['hire_fee_attempt_id']:'${attemptId}'`, limit: 2 });
      if (r.data.length > 1) throw new Error("multiple payment intents for one attempt");   // 想定外。自動では確定せず、運営の確認へ
      return r.data[0] ? intentLite(r.data[0]) : null;
    },
  };
}

/** 故障の再現はテスト鍵（livemode=false）かつ本番環境でないときだけ有効。 */
export function faultFromEnv(env: NodeJS.ProcessEnv, livemode: boolean): Fault | undefined {
  const v = env.HIRE_CHARGE_TEST_FAULT;
  if (!v || livemode || env.VERCEL_ENV === "production") return undefined;   // 本番鍵・本番環境では無効
  return v === "stop_before_send" || v === "lose_response" || v === "fail_record" ? v : undefined;
}
