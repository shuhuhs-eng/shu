import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * 定期クリーンアップ（Vercel Cron等の外部スケジューラから実行する）。
 *
 * 削除対象（これだけ。冪等・多重実行しても安全）:
 *   ・pending_diagnoses のうち expires_at を過ぎた行（未ログイン診断の一時保存。診断結果の本体は
 *     diagnosis_results に保存済みで、source_pending_id は on delete set null のため失われない）
 *   ・rate_limit_counters のうち2日より古い行（共有レート制限のカウンター）
 * 課金・成功報酬・請求書・監査履歴・法的同意・採用データ・診断結果は一切削除しない。
 *
 * メソッド:
 *   ・GET  … Vercel Cron はGETで呼び出し、CRON_SECRET を `Authorization: Bearer` で自動付与する。
 *   ・POST … 手動実行・他のスケジューラ向け（同じ認証）。
 *
 * 認証: `Authorization: Bearer <CRON_SECRET>` が一致しない場合は拒否（定数時間比較）。
 * CRON_SECRET が未設定の場合は実行しない（500）。公開インターネットから勝手に実行できない。
 */
async function run(request: Request) {
  const auth = verifyCronAuth(request.headers.get("authorization"));
  if (auth === "not_configured") {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 500 });
  }
  if (auth !== "ok") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("cleanup_expired_pending_diagnoses");
  if (error) {
    console.error("[cron] cleanup_expired_pending_diagnoses failed", { code: error.code });
    return NextResponse.json({ error: "cleanup_failed" }, { status: 500 });
  }

  // レート制限カウンターの掃除は付随処理。失敗しても診断の掃除結果は返す。
  let deletedRateLimitRows: number | null = null;
  const rl = await supabase.rpc("cleanup_rate_limit_counters");
  if (rl.error) {
    console.error("[cron] cleanup_rate_limit_counters failed", { code: rl.error.code });
  } else {
    deletedRateLimitRows = rl.data;
  }

  return NextResponse.json({ success: true, deletedCount: data, deletedRateLimitRows });
}

export const GET = run;
export const POST = run;
