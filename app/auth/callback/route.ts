import { NextResponse } from "next/server";
import { safeInternalPath } from "@/lib/auth/safe-path";
import { createClient } from "@/lib/supabase/server";
import { determinePostAuthPath } from "@/lib/auth/post-auth-redirect";
import { cookies } from "next/headers";
import { claimPendingDiagnosisForNewAccount } from "@/lib/diagnosis-handoff/claim";
import { CLAIM_TOKEN_COOKIE, GUEST_NOT_CARRIED_NOTICE_COOKIE, GUEST_SIGNUP_UNVERIFIED_COOKIE } from "@/lib/diagnosis-handoff/constants";

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
  // サーバー側で、登録時にサーバーが署名した「新規登録の印」（ユーザーID×ゲスト診断・24時間以内）を確認し、
  // 満たさない場合（既存アカウント・期限切れ等）は何も保存しない。URLのフラグだけで引き継ぎが起きることはない。
  // 失敗してもコールバック処理は継続する。
  const {
    data: { user: confirmedUser },
  } = await supabase.auth.getUser();
  if (confirmedUser && !next) {
    const hadGuestDiagnosis = !!(await cookies()).get(CLAIM_TOKEN_COOKIE)?.value;
    const claim = await claimPendingDiagnosisForNewAccount(confirmedUser);
    if (hadGuestDiagnosis && !claim.claimed) {
      // 初回結果を引き継げなかった。マイページで案内する（表示専用。結果が保存されるまで表示）。
      // 登録時に「新規作成の確認ができなかった」目印があれば unverified、なければ（印の期限切れ等）expired。
      const unverified = !!(await cookies()).get(GUEST_SIGNUP_UNVERIFIED_COOKIE)?.value;
      (await cookies()).delete(GUEST_SIGNUP_UNVERIFIED_COOKIE);
      (await cookies()).set(GUEST_NOT_CARRIED_NOTICE_COOKIE, unverified ? "unverified" : "expired", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 7 * 24 * 60 * 60,
      });
    }
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
