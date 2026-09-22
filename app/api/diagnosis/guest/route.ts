import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import {
  DIAGNOSIS_VERSION,
  isValidAnswers,
  computeDiagnosis,
  type DiagnosisMode,
} from "@/lib/diagnosis";
import { CLAIM_TOKEN_COOKIE, CLAIM_TOKEN_MAX_AGE_SECONDS } from "@/lib/diagnosis-handoff/constants";

/**
 * 未ログイン状態で診断を完了したときに呼ばれるAPI。
 *
 * ・回答データ(answers)と診断バージョンのみを pending_diagnoses へ保存する。
 *   スコア・タイプ・市場価値はここでは保存しない（登録後にサーバーで回答から
 *   再計算する方針のため）。
 * ・pending_diagnoses はRLSポリシーが無く直接アクセス不可のテーブルなので、
 *   ここでは service role クライアントを使って書き込む。
 * ・生成された claim_token を httpOnly Cookie に保存する。localStorageのみに
 *   依存せず、Cookie経由でサーバーが安全に照合できるようにするため。
 * ・レスポンスには即時表示用の計算結果を含めるが、これは表示専用であり、
 *   ログイン後にサーバー側で回答から再計算した値のみが真値として保存される。
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { mode, answers } = body as { mode?: unknown; answers?: unknown };

  if (mode !== "stylist" && mode !== "salon") {
    return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
  }
  const validatedMode = mode as DiagnosisMode;

  if (!isValidAnswers(validatedMode, answers)) {
    return NextResponse.json({ error: "invalid_answers" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: inserted, error } = await supabase
    .from("pending_diagnoses")
    .insert({
      mode: validatedMode,
      answers,
      diagnosis_version: DIAGNOSIS_VERSION,
    })
    .select("*")
    .single();

  if (error || !inserted) {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  const cookieStore = await cookies();
  cookieStore.set(CLAIM_TOKEN_COOKIE, inserted.claim_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CLAIM_TOKEN_MAX_AGE_SECONDS,
  });

  // 表示専用の即時計算結果（真値ではない。登録後にサーバーで再計算される）。
  const preview = computeDiagnosis(validatedMode, answers);

  return NextResponse.json({ success: true, preview });
}
