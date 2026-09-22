import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * 期限切れの pending_diagnoses を削除する。
 *
 * pg_cron 拡張が使えるSupabaseプロジェクトであれば、DB側で直接スケジュールする方が
 * シンプル（supabase/migrations の cleanup_expired_pending_diagnoses() 関数コメント参照）。
 * このRoute Handlerは、pg_cronが使えない環境向けに、外部スケジューラ
 * （Vercel Cron・GitHub Actions等）から定期的に叩くための代替経路。
 *
 * 認証: Authorization: Bearer <CRON_SECRET> ヘッダが一致しない場合は拒否する。
 * このエンドポイントは anon キーでは到達できない機密操作ではないが、
 * 誰でも連打できると不要なDB負荷になるため、共有シークレットで軽く保護する。
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("cleanup_expired_pending_diagnoses");

  if (error) {
    return NextResponse.json({ error: "cleanup_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true, deletedCount: data });
}
