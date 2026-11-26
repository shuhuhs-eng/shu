import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { getStripe, currentStripeLivemode } from "@/lib/stripe/client";
import { runHireFeeJob } from "@/lib/billing/hire-charge";
import { faultFromEnv, makeHireChargeDb, makeHireChargeStripe } from "@/lib/billing/hire-charge-adapters";
import { logError } from "@/lib/security/log";
import { hireBillingEnabled } from "@/lib/billing/hire-flags";

/**
 * 採用料の自動請求ジョブ（1時間ごと。Vercel Cron）。認証: Authorization: Bearer <CRON_SECRET>。
 * 停止の段階（実装・PC手順・試験で同じ）:
 *   ・ジョブ停止（環境変数 HIRE_BILLING_ENABLED が "1" でない（画面・サーバー処理と共通の判定 hireBillingEnabled））: 何もしない（Stripeへの通信もDBの変更もしない）。既定。
 *   ・請求停止（DBの設定 auto_charge_enabled が false）: 復旧は『照合だけ』（Stripeを読み取り、結果を反映するだけ。決済は発生しない）。新しい請求・再送はしない。
 *   ・請求有効（どちらも有効）: ①復旧（照合＋同じ冪等キーでの再送）→ ②期日が来た請求（カーソルで全件）。
 * DBの設定を読めないときは請求停止として扱う。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 1ページの件数（既定20）。PC検証で小さくして、ページ送りを再現できる。 */
const pageSize = (v: string | undefined) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 100 ? n : 20; };

async function run(request: Request) {
  const auth = verifyCronAuth(request.headers.get("authorization"));
  if (auth === "not_configured") return NextResponse.json({ error: "cron_not_configured" }, { status: 500 });
  if (auth !== "ok") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hireBillingEnabled()) return NextResponse.json({ ok: true, enabled: false });

  const supabase = createServiceClient();
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await (supabase.rpc as unknown as (f: string, a: unknown) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };
  try {
    const livemode = currentStripeLivemode();
    const db = makeHireChargeDb(rpc);
    const stripe = makeHireChargeStripe(getStripe());
    const job = await runHireFeeJob({ db, stripe, expectedLivemode: livemode, limit: pageSize(process.env.HIRE_CHARGE_PAGE_SIZE), deadlineMs: 240_000, fault: faultFromEnv(process.env, livemode) });
    return NextResponse.json({ ok: true, ...job });
  } catch (e) {
    logError("cron hire-fee-charge failed", e);
    return NextResponse.json({ error: "charge_job_failed" }, { status: 500 });
  }
}
export const GET = run;
export const POST = run;
