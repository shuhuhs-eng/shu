import { NextResponse } from "next/server";
import { safeInternalPath } from "@/lib/auth/safe-path";
import { createClient } from "@/lib/supabase/server";
import { determinePostAuthPath } from "@/lib/auth/post-auth-redirect";
import { claimPendingDiagnosisForNewAccount } from "@/lib/diagnosis-handoff/claim";

/**
 * メール認証（新規登録の確認リンク）・パスワード再設定リンクの共通コールバック。
 * ・?code=...            Supabase から付与される認証コード（PKCE）
 * ・?next=/update-password  パスワード再設定フローの場合に明示的に付与される行き先
 *
 * next が無い場合（＝新規登録の確認リンク）の行き先判定（role・onboarding_step）は
 * determinePostAuthPath() に集約している（lib/auth/actions.ts の signInAction と
 * 同じロジックを1箇所で管理するため）。
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeInternalPath(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=invalid_callback`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  // 新規登録の確認リンク（行き先 next が無いもの）の場合だけ、ゲスト診断を「新規アカウントの初回結果」として
  // 引き継ぐ。パスワード再設定（next あり）では引き継がない。さらに claimPendingDiagnosisForNewAccount が
  // サーバー側で、登録時に入れた印・アカウント作成・メール確認の時刻を確認し、満たさない場合（既存アカウント等）は
  // 何も保存しない。URLのフラグだけで引き継ぎが起きることはない。失敗してもコールバック処理は継続する。
  const {
    data: { user: confirmedUser },
  } = await supabase.auth.getUser();
  if (confirmedUser && !next) {
    await claimPendingDiagnosisForNewAccount(confirmedUser);
  }

  // パスワード再設定フローなど、行き先が明示されている場合はそちらを優先。
  if (next) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  if (!confirmedUser) {
    return NextResponse.redirect(`${origin}/login`);
  }

  return NextResponse.redirect(`${origin}${await determinePostAuthPath(supabase, confirmedUser.id)}`);
}
