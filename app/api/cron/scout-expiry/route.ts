import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { scoutLedgerEnabled } from "@/lib/billing/hire-flags";
import { logError } from "@/lib/security/log";

/**
 * スカウト購入分の期限切れを毎日まとめて失効として記録する（日本時間 0:10。Vercel Cron）。認証: Authorization: Bearer <CRON_SECRET>。
 *  ・SCOUT_LEDGER_ENABLED が "1" でないとき: 何もしない（DBにも触れない）。
 *  ・DBの service_scout_expire_due が、期限切れの未使用分を台帳へ失効（expiry）として追記し、実行の履歴（scout_expiry_runs）を残す。冪等で、多重実行しても二重に失効しない。
 *  ・1法人の失敗は他の法人を止めない（失敗数が履歴に残り、次回に再試行）。残高は失効の記録の有無にかかわらず、期限切れを除いた値で表示・判定される。
 * ★返金・残高の取消・決済には一切触れない。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function run(request: Request) {
  const auth = verifyCronAuth(request.headers.get("authorization"));
  if (auth === "not_configured") return NextResponse.json({ error: "cron_not_configured" }, { status: 500 });
  if (auth !== "ok") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!scoutLedgerEnabled()) return NextResponse.json({ ok: true, enabled: false });
  try {
    const supabase = createServiceClient();
    const { data, error } = await (supabase.rpc as unknown as (f: string) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>)("service_scout_expire_due");
    if (error) { logError("cron scout-expiry failed", new Error(error.code ?? "rpc_error")); return NextResponse.json({ error: "expiry_failed" }, { status: 500 }); }
    return NextResponse.json({ ok: true, enabled: true, result: data });
  } catch (e) {
    logError("cron scout-expiry failed", e);
    return NextResponse.json({ error: "expiry_failed" }, { status: 500 });
  }
}
export const GET = run;
export const POST = run;
