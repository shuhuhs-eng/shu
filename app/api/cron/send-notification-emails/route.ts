import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { verifyCronAuth } from "@/lib/cron/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { createMailProvider } from "@/lib/email/provider";
import { runEmailWorker } from "@/lib/email/worker";

/**
 * 通知メールの送信ワーカー（外部スケジューラから一定間隔で呼ぶ）。画面や業務処理からは呼ばない。
 *   ・送る対象は DB の送信待ち（0100）だけ。DB側で「開始前／停止中」は何も取り出さない。
 *   ・EMAIL_PROVIDER が未設定/disabled のときは、取り出しもせず何もしない（送信待ちは溜まったまま）。
 *   ・認証: `Authorization: Bearer <CRON_SECRET>`（他のcronと同じ）。未設定なら実行しない。
 *   ・複数同時に動いても二重送信しない（DB側で取り出しを排他）。
 */
/** 1回の実行は最大50秒の時間予算で打ち切る（lib/email/worker.ts）。関数の実行時間上限はそれより長く取る。 */
export const maxDuration = 60;

async function run(request: Request) {
  const auth = verifyCronAuth(request.headers.get("authorization"));
  if (auth === "not_configured") return NextResponse.json({ error: "cron_not_configured" }, { status: 500 });
  if (auth !== "ok") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let provider;
  try { provider = createMailProvider(); } catch (e) {
    console.error("[cron] mail provider misconfigured", { message: e instanceof Error ? e.message : "unknown" });
    return NextResponse.json({ error: "provider_misconfigured" }, { status: 500 });
  }
  if (provider.name === "disabled") return NextResponse.json({ success: true, skipped: "provider_disabled" });
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  if (!siteUrl.trim()) return NextResponse.json({ error: "site_url_not_configured" }, { status: 500 });

  try {
    const result = await runEmailWorker({ client: createServiceClient(), provider, workerId: `w-${randomUUID().slice(0, 12)}`, siteUrl });
    return NextResponse.json({ success: true, provider: provider.name, ...result });
  } catch (e) {
    console.error("[cron] send-notification-emails failed", { message: e instanceof Error ? e.message : "unknown" });
    return NextResponse.json({ error: "worker_failed" }, { status: 500 });
  }
}
export const GET = run;
export const POST = run;
