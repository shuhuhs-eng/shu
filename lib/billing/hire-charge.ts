/**
 * 採用料の自動請求（請求ジョブの業務処理。純粋なロジック。DB RPC と Stripe は依存注入のため、本物なしでテストできる）。
 *
 * ★本番の請求は保留中。DB側で auto_charge_enabled が false の間は期日一覧が空になり、何も請求されない。
 * ★二重請求の防止: 請求の開始（DBが試行行と冪等キーを確定）→ 送信直前の印 → Stripe へ『同じ冪等キー』で請求 → 結果を記録。
 * ★停止からの復旧（runHireFeeRecovery）。停止した場所で扱いを分ける:
 *     ・送信前に停止（試行は進行中・送信の印なし） … Stripe に何も無いことを照合し、同じ試行・同じ冪等キーで送信する
 *     ・送信後に応答が消失（進行中・印あり） … まず Stripe を照合（metadata の試行ID）。あればその結果を反映。無ければ同じ冪等キーで再送（Stripeが同じ結果を返す）
 *     ・結果の記録に失敗（Stripe側は完了） … 照合で見つかった結果を反映
 *     ・冪等キーの保持期間（24時間）が近い／過ぎた場合は再送せず『結果不明』にして運営の確認へ回す
 *   結果不明のまま新しい試行は作らない（DBが拒否）。照合で決済が見つからない結果不明は、確認されるまで残す。
 * ★Stripeのモード（テスト/本番）が会社の決済連携のモードと違うときは請求しない。
 * ★ログ・戻り値にカード情報・顧客IDは含めない（件数と結果コードのみ）。
 */
export type ChargeInfo = {
  attempt_id: string; idempotency_key: string; attempt_no: number; total_amount: number; schedule_id: string;
  agreement_id: string; organization_id: string; stripe_customer_id: string | null; payment_method_id: string | null; livemode: boolean | null;
};
export type DueRow = { id: string; key_date: string };
export type BeginResult = { attempt_id: string };
export type Recoverable = { attempt_id: string; status: "in_progress" | "unknown"; sent_at: string | null; started_at: string; age_minutes: number; idempotency_key: string; external_ref: string | null; attempt_no: number; schedule_id: string };

export type HireChargeDb = {
  due(limit: number, after: DueRow | null): Promise<DueRow[]>;
  begin(scheduleId: string, expectedLivemode: boolean): Promise<BeginResult | { skipped: string }>;
  info(attemptId: string): Promise<ChargeInfo | null>;
  markSent(attemptId: string): Promise<boolean>;
  record(attemptId: string, result: "succeeded" | "failed" | "unknown", ref: string | null): Promise<void>;
  recoverable(minAgeMinutes: number, limit: number): Promise<Recoverable[]>;
  /** DBの設定 auto_charge_enabled。false の間（請求停止中）は、決済を発生させる送信（新しい請求・再送）をしない。 */
  autoChargeEnabled(): Promise<boolean>;
  /** Stripe照合・通知の反映（DBが金額・通貨・顧客・モード・請求予定・決済IDを照合する）。 */
  applyFacts(a: IntentFacts & { attemptId: string; result: "succeeded" | "failed"; eventId: string; source: "stripe_lookup" | "stripe_webhook" }): Promise<string>;
};
export type IntentFacts = { paymentIntentId: string; amount: number; currency: string; customerId: string | null; livemode: boolean; scheduleId: string | null };
export type IntentLite = IntentFacts & { status: string };
export type ChargeArgs = { amountYen: number; customerId: string; paymentMethodId: string; idempotencyKey: string; metadata: Record<string, string> };
export type HireChargeStripe = {
  /** 冪等キー付きで保存済みの支払い方法へオフセッション請求する。支払い拒否は {declined}、通信断などは例外。 */
  charge(a: ChargeArgs): Promise<IntentLite | { declined: true; intent: IntentLite | null }>;
  /** metadata の試行IDで、既に作られた PaymentIntent を探す（無ければ null）。 */
  findByAttempt(attemptId: string): Promise<IntentLite | null>;
};
/** テスト環境だけの故障の再現（本番では無効。ルート側で test 鍵のときだけ渡す）。 */
export type Fault = "stop_before_send" | "lose_response" | "fail_record";
export type HireChargeSummary = { due: number; succeeded: number; failed: number; unknown: number; skipped: number; errors: number; pages: number };
export type RecoverySummary = { found: number; applied: number; resent: number; markedUnknown: number; left: number; held: number; errors: number };

/** Stripeの冪等キーは24時間で失効する。余裕を持って23時間を超えたら再送しない。 */
export const IDEMPOTENCY_SAFE_MINUTES = 23 * 60;
export const RECOVERY_MIN_AGE_MINUTES = 15;

export function resultOfIntent(pi: IntentLite | { declined: true; intent: IntentLite | null }): { result: "succeeded" | "failed" | "unknown"; ref: string | null } {
  if ("declined" in pi) return pi.intent ? resultOfIntent(pi.intent) : { result: "failed", ref: null };
  if (pi.status === "succeeded") return { result: "succeeded", ref: pi.paymentIntentId };
  if (pi.status === "requires_payment_method" || pi.status === "canceled") return { result: "failed", ref: pi.paymentIntentId };
  return { result: "unknown", ref: pi.paymentIntentId };   // processing / requires_action など
}

async function send(deps: { db: HireChargeDb; stripe: HireChargeStripe; fault?: Fault }, info: ChargeInfo, attemptId: string): Promise<{ result: "succeeded" | "failed" | "unknown"; ref: string | null } | "stopped"> {
  const marked = await deps.db.markSent(attemptId);
  if (!marked) return "stopped";   // 進行中でなくなった（通知で確定した等）: 送らない
  if (deps.fault === "stop_before_send") return "stopped";   // 試験: 印の後・送信の前に停止
  let outcome: { result: "succeeded" | "failed" | "unknown"; ref: string | null };
  try {
    const pi = await deps.stripe.charge({
      amountYen: info.total_amount, customerId: info.stripe_customer_id!, paymentMethodId: info.payment_method_id!,
      idempotencyKey: info.idempotency_key, metadata: { hire_fee_attempt_id: attemptId, hire_fee_schedule_id: info.schedule_id },
    });
    outcome = resultOfIntent(pi);
  } catch {
    outcome = { result: "unknown", ref: null };   // 通信断など: 請求されたかどうか分からない。新しい試行は作らず、照合で確定する
  }
  if (outcome.result === "succeeded" && !outcome.ref) outcome = { result: "unknown", ref: null };
  if (deps.fault === "lose_response") return "stopped";   // 試験: Stripeへは送信済みだが、応答を受け取らずに停止
  return outcome;
}

export async function runHireFeeCharges(deps: { db: HireChargeDb; stripe: HireChargeStripe; expectedLivemode: boolean; limit?: number; maxPages?: number; deadlineMs?: number; now?: () => number; fault?: Fault }): Promise<HireChargeSummary> {
  const sum: HireChargeSummary = { due: 0, succeeded: 0, failed: 0, unknown: 0, skipped: 0, errors: 0, pages: 0 };
  const limit = deps.limit ?? 20; const now = deps.now ?? Date.now; const deadline = deps.deadlineMs ? now() + deps.deadlineMs : Infinity;
  let after: DueRow | null = null;
  // 先頭が開始できない案件（モード違い等）で埋まっても、カーソルで後続のページへ進む。
  for (let page = 0; page < (deps.maxPages ?? 50) && now() < deadline; page++) {
    const rows = await deps.db.due(limit, after);
    sum.pages++; sum.due += rows.length;
    for (const row of rows) {
      if (now() >= deadline) return sum;
      let attemptId: string | null = null;
      try {
        const b = await deps.db.begin(row.id, deps.expectedLivemode);
        if ("skipped" in b) { sum.skipped++; continue; }
        attemptId = b.attempt_id;
        const info = await deps.db.info(attemptId);
        if (!info || !info.stripe_customer_id || !info.payment_method_id || info.livemode !== deps.expectedLivemode) {
          await deps.db.record(attemptId, "failed", null); sum.failed++; continue;   // 開始後に支払い方法が消えた・モード違い: 請求しない
        }
        const o = await send(deps, info, attemptId);
        if (o === "stopped") { sum.errors++; continue; }
        if (deps.fault === "fail_record") { sum.errors++; continue; }   // 試験: Stripeは完了したが、結果の記録に失敗
        await deps.db.record(attemptId, o.result, o.ref);
        sum[o.result]++;
      } catch {
        sum.errors++;   // この1件は止めて次へ。進行中の試行は復旧（Stripe照合）で確定する
      }
    }
    if (rows.length < limit) break;
    after = rows[rows.length - 1];
  }
  return sum;
}

/**
 * 停止した試行の復旧。同じ試行・同じ冪等キーで、Stripeの実際の状態に合わせる。新しい試行は作らない。
 * ★照合だけ（allowResend=false。既定）と、決済を発生させる再送（allowResend=true）を分ける。
 *   ・照合だけ: Stripeを読み取り、見つかった結果をDBへ反映するだけ。決済は発生しない。請求停止中も行える。
 *   ・再送: Stripeに決済が無い試行を、同じ冪等キーで送り直す。請求が有効（DBの auto_charge_enabled）の間だけ。停止中は試行を変えずに残す（held）。
 */
export async function runHireFeeRecovery(deps: { db: HireChargeDb; stripe: HireChargeStripe; expectedLivemode: boolean; limit?: number; minAgeMinutes?: number; allowResend?: boolean }): Promise<RecoverySummary> {
  const sum: RecoverySummary = { found: 0, applied: 0, resent: 0, markedUnknown: 0, left: 0, held: 0, errors: 0 };
  const items = await deps.db.recoverable(deps.minAgeMinutes ?? RECOVERY_MIN_AGE_MINUTES, deps.limit ?? 50);
  sum.found = items.length;
  for (const it of items) {
    try {
      const pi = await deps.stripe.findByAttempt(it.attempt_id);
      if (pi) {
        const r = resultOfIntent(pi);
        if (r.result === "unknown") {
          if (it.status === "in_progress") { await deps.db.record(it.attempt_id, "unknown", pi.paymentIntentId); sum.markedUnknown++; } else sum.left++;
          continue;   // 処理中: 確定する通知を待つ
        }
        const res = await deps.db.applyFacts({ ...pi, attemptId: it.attempt_id, result: r.result, eventId: `lookup:${it.attempt_id}:${pi.paymentIntentId}`, source: "stripe_lookup" });
        if (res === "applied" || res === "resolved" || res === "repeated") sum.applied++; else sum.left++;   // mismatch / conflict は確認記録がDBに残る
        continue;
      }
      // Stripeに決済が無い。進行中だけ、同じ冪等キーで再送できる（冪等キーの有効期間内に限る）。
      if (it.status !== "in_progress") { sum.left++; continue; }
      if (it.age_minutes >= IDEMPOTENCY_SAFE_MINUTES) { await deps.db.record(it.attempt_id, "unknown", null); sum.markedUnknown++; continue; }   // 決済は発生しない記録だけ。停止中も行う
      if (!deps.allowResend) { sum.held++; continue; }   // 請求停止中（または照合だけの実行）: 再送しない。再開後の復旧で扱う
      const info = await deps.db.info(it.attempt_id);
      if (!info || !info.stripe_customer_id || !info.payment_method_id || info.livemode !== deps.expectedLivemode || info.idempotency_key !== it.idempotency_key) { sum.left++; continue; }
      const o = await send({ db: deps.db, stripe: deps.stripe }, info, it.attempt_id);
      if (o === "stopped") { sum.left++; continue; }
      await deps.db.record(it.attempt_id, o.result, o.ref);
      sum.resent++;
    } catch {
      sum.errors++;
    }
  }
  return sum;
}

export type HireJobSummary = { billingEnabled: boolean; recovery: RecoverySummary; charges: HireChargeSummary | null };
/**
 * 1回のジョブ: ①復旧 → ②期日が来た請求。請求の可否は、DBの設定 auto_charge_enabled を1回だけ読んで決める。
 *   ・有効: 復旧（照合＋再送）→ 新しい請求
 *   ・停止中（false）: 復旧は『照合だけ』（再送しない）。新しい請求は始めない。
 * 設定の読み取りに失敗したら、停止中として扱う（決済を発生させない側に倒す）。
 */
export async function runHireFeeJob(deps: { db: HireChargeDb; stripe: HireChargeStripe; expectedLivemode: boolean; limit?: number; deadlineMs?: number; fault?: Fault }): Promise<HireJobSummary> {
  let enabled = false;
  try { enabled = (await deps.db.autoChargeEnabled()) === true; } catch { enabled = false; }
  const recovery = await runHireFeeRecovery({ db: deps.db, stripe: deps.stripe, expectedLivemode: deps.expectedLivemode, allowResend: enabled });
  const charges = enabled ? await runHireFeeCharges({ db: deps.db, stripe: deps.stripe, expectedLivemode: deps.expectedLivemode, limit: deps.limit, deadlineMs: deps.deadlineMs, fault: deps.fault }) : null;
  return { billingEnabled: enabled, recovery, charges };
}
