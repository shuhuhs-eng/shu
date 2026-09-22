import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { determinePostAuthPath } from "@/lib/auth/post-auth-redirect";
import { claimPendingDiagnosisIfPresent } from "@/lib/diagnosis-handoff/claim";

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
  const next = searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=invalid_callback`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  // 未ログイン時に受けた診断結果があれば、ここで本人アカウントへ紐づける。
  // 失敗してもコールバック処理自体は継続する（ベストエフォート）。
  await claimPendingDiagnosisIfPresent();

  // パスワード再設定フローなど、行き先が明示されている場合はそちらを優先。
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  return NextResponse.redirect(`${origin}${await determinePostAuthPath(supabase, user.id)}`);
}
