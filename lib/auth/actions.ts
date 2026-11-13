"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site-url";
import { cookies, headers } from "next/headers";
import { getClientIpFromHeaders } from "@/lib/rate-limit/memory-rate-limiter";
import { checkSharedRateLimit } from "@/lib/rate-limit/shared-rate-limiter";
import { CAPTCHA_REQUIRED_MESSAGE, requireCaptchaToken } from "@/lib/security/bot-protection";
import { safeInternalPath } from "@/lib/auth/safe-path";
import { checkSignupRateLimit, signupRateLimitMessage } from "@/lib/auth/signup-rate-limit";
import { describeAuthError } from "@/lib/auth/errors";
import { determinePostAuthPath, determineRoleEntryPath } from "@/lib/auth/post-auth-redirect";
import { claimPendingDiagnosisForNewAccount, discardGuestDiagnosisCookie } from "@/lib/diagnosis-handoff/claim";
import { CLAIM_BINDING_METADATA_KEY, CLAIM_TOKEN_COOKIE } from "@/lib/diagnosis-handoff/constants";
import { hashClaimToken } from "@/lib/diagnosis-handoff/new-account";
import {
  signUpSchema,
  loginSchema,
  requestResetSchema,
  updatePasswordSchema,
} from "@/lib/validation/auth";
import type { AuthActionState } from "@/lib/auth/types";


// ---------------------------------------------------------------------------
// 新規登録（stylist / salon 共通ヘルパー）
// ---------------------------------------------------------------------------
async function performSignUp(
  role: "stylist" | "salon",
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signUpSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      error: "入力内容をご確認ください。",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { displayName, email, password } = parsed.data;

  // Bot対策: 本番ではTurnstileのトークンが無い送信をSupabaseへ流さない。検証そのものはSupabase Auth
  // （Dashboardで有効化したAuth CAPTCHA）が行う。無効なトークンはSupabase側で拒否される。
  const captcha = requireCaptchaToken(formData);
  if (!captcha.ok) return { error: CAPTCHA_REQUIRED_MESSAGE };

  // 大量アカウント作成の抑止。メール単位を主、IP単位は大量の異常試行だけを抑える安全弁
  // （同じ店舗・説明会など共有ネットワークの複数人が登録できる値。設定は lib/rate-limit/config.ts）。
  // Turnstile確認（上）を通った後にだけ数える。
  const ip = getClientIpFromHeaders(await headers());
  const signupLimit = await checkSignupRateLimit({ ip, email });
  if (!signupLimit.allowed) {
    return { error: signupRateLimitMessage(signupLimit) };
  }

  const supabase = await createClient();

  // ゲスト診断につながる新規登録の印: このブラウザに保留中のゲスト診断（Cookie）があれば、そのトークンの
  // ハッシュを user_metadata に入れる。メール確認後のコールバックが「この新規アカウントは、この診断につながる
  // 登録として作られた」ことをサーバー側で確かめるために使う。既存アカウントのログインには入らない。
  const guestClaimToken = (await cookies()).get(CLAIM_TOKEN_COOKIE)?.value;
  const claimBinding = guestClaimToken ? { [CLAIM_BINDING_METADATA_KEY]: hashClaimToken(guestClaimToken) } : {};

  // signUpが例外で終わった場合（通信切断など）は結果が分からないため、予約はそのまま残す
  // （期限で自動的に枠から外れる。未確認の要求を「消費した」とも「消費していない」とも断定しない）。
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${getSiteUrl()}/auth/callback`,
      data: { display_name: displayName, role, ...claimBinding },
      captchaToken: captcha.captchaToken,
    },
  });

  // Supabase Authの応答が分かった。CAPTCHA検証に失敗した要求（偽・期限切れ・使用済みトークン）は、
  // メール単位の枠を消費しない（release）。それ以外は枠を消費する（confirm）。IP単位の消費は戻さない。
  await signupLimit.settle(error?.code === "captcha_failed" ? "release" : "confirm");

  if (error) {
    return { error: describeAuthError("signup", error) };
  }

  // ★「1 auth user = 1 role」方針: 別roleを追加する経路を作らないことを
  // 最優先とする対応。Supabase Authでは、既存のメールアドレスへ再度
  // signUp()を呼んだ場合、セキュリティ上の理由（メールアドレスの存在を
  // 外部に漏らさないため）でエラーは返らず、代わりに
  // data.user.identities が空配列になる（新しいidentityが追加されない）
  // という既知の挙動がある。これを検知し、既存アカウント（美容師登録済み
  // メールでサロン登録を試みた場合等）に対して新しいroleを追加する余地を
  // 生まないようにする。
  // ★正直な注記: この判定はSupabase Auth側の設定（メール確認要否等）に
  // 依存する可能性があり、このサンドボックスでは実際の挙動を検証できない。
  // 実機のSupabase環境で必ず動作確認すること。
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return {
      error: "このメールアドレスは既に登録されています。ログインをご利用ください。",
    };
  }

  // メール確認が不要な設定（signUpの時点でセッションが作られる）の場合は、ここで「本当に新しく作られた
  // アカウント」の初回結果としてゲスト診断を引き継ぐ。確認メールが必要な設定では、確認リンクのコールバックで行う。
  if (data.session && data.user) {
    await claimPendingDiagnosisForNewAccount(data.user);
  }

  return {
    success:
      "確認メールを送信しました。数分待ってもメールが届かない場合は、すでに登録済みのメールアドレスである可能性があります。ログインまたはパスワードを再設定してください。美容師とサロンは別々のアカウントです。もう一方の種類で登録する場合は、別のメールアドレスをご用意ください。",
  };
}

export async function signUpAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  return performSignUp("stylist", formData);
}

/**
 * サロンアカウントの新規登録。signUpAction（美容師）と対称構造。
 * role: "salon" をサインアップのメタデータに含める点のみが差分で、
 * これを handle_new_user() が読み取り profiles.role を決定する
 * （'stylist'/'salon' 以外の値は無視され既定の'stylist'にフォールバックするため、
 * クライアントから任意のroleを自己付与することはできない）。
 */
export async function signUpSalonAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  return performSignUp("salon", formData);
}

// ---------------------------------------------------------------------------
// ログイン
// ---------------------------------------------------------------------------
export async function signInAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      error: "入力内容をご確認ください。",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { email, password } = parsed.data;

  const captcha = requireCaptchaToken(formData);
  if (!captcha.ok) return { error: CAPTCHA_REQUIRED_MESSAGE };

  // パスワード総当たりの抑止（IP単位 10分30回 + メール単位 10分10回）。共有（DBベース）のレート制限。
  // 共有NAT（サロンの店内回線）を考慮してIP単位は緩めに設定。
  const ip = getClientIpFromHeaders(await headers());
  const loginLimit = await checkSharedRateLimit(`login:ip:${ip}`, 30, 10 * 60 * 1000);
  const loginEmailLimit = await checkSharedRateLimit(`login:email:${email.toLowerCase()}`, 10, 10 * 60 * 1000);
  if (!loginLimit.allowed || !loginEmailLimit.allowed) {
    return { error: "ログイン試行が多すぎます。しばらく待ってからお試しください。" };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken: captcha.captchaToken },
  });
  if (error) {
    return { error: describeAuthError("login", error) };
  }

  // ★既存アカウントへのログインでは、未ログイン時に出したゲスト診断を保存しない（取り込まない）。
  // 保存済みの診断結果・タイプ・マイページの表示は変えない。ログインしたことを、ゲスト診断を保存することへの
  // 同意として扱わない。このブラウザに残っている保留Cookieは、後日の再ログイン・メール確認・別アカウントへの
  // 切り替えで遅れて取り込まれないよう、ここで破棄する。
  await discardGuestDiagnosisCookie();

  // 保護ルートから弾かれてログインに来た場合は、元のURLへ戻す（安全なパスのみ）。
  const next = safeInternalPath(formData.get("next"));
  if (next) {
    redirect(next);
  }

  // 初回ログイン時のonboarding判定・role判定は共通関数に集約している
  // （app/auth/callback/route.ts と同じロジックを1箇所で管理するため）。
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // 役割別ログイン入口（/stylist/login・/salon/login）から来た場合は、
    // その役割専用の遷移先を優先する（"next"パラメータでの保護ルート復帰の
    // 次に優先。両方無ければ既存のdeterminePostAuthPathへフォールバックする）。
    const entryMode = formData.get("entryMode");
    if (entryMode === "stylist" || entryMode === "salon") {
      const dest = await determineRoleEntryPath(supabase, user.id, entryMode);
      redirect(dest);
    }

    const dest = await determinePostAuthPath(supabase, user.id);
    redirect(dest);
  }

  redirect("/");
}

// ---------------------------------------------------------------------------
// パスワード再設定メールの送信
// ---------------------------------------------------------------------------
export async function requestPasswordResetAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = requestResetSchema.safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    return {
      error: "入力内容をご確認ください。",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const captcha = requireCaptchaToken(formData);
  if (!captcha.ok) return { error: CAPTCHA_REQUIRED_MESSAGE };

  // メール送信の乱用抑止（IP単位 1時間5回 + 宛先メール単位 1時間3回）。共有（DBベース）のレート制限。
  // 超過時も存在有無を示唆しない同一メッセージを返す。
  const ip = getClientIpFromHeaders(await headers());
  const resetLimit = await checkSharedRateLimit(`password-reset:ip:${ip}`, 5, 60 * 60 * 1000);
  const resetEmailLimit = await checkSharedRateLimit(`password-reset:email:${parsed.data.email.toLowerCase()}`, 3, 60 * 60 * 1000);
  if (!resetLimit.allowed || !resetEmailLimit.allowed) {
    return { success: "再設定メールを送信しました。" };
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${getSiteUrl()}/auth/callback?next=/update-password`,
    captchaToken: captcha.captchaToken,
  });

  // アカウント存在の有無を漏らさないため、成否によらず同じ成功メッセージを返す。
  // 文言はメールアドレスの登録有無を一切示唆しない（存在確認に使えない）ものにしている。
  return {
    success: "再設定メールを送信しました。",
  };
}

// ---------------------------------------------------------------------------
// パスワード更新（再設定メールのリンク経由でセッションが確立されている状態で呼ばれる）
// ---------------------------------------------------------------------------
export async function updatePasswordAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = updatePasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      error: "入力内容をご確認ください。",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: "セッションが無効です。お手数ですが、パスワード再設定をもう一度お試しください。",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: describeAuthError("update_password", error) };
  }

  // 更新後は明示的にサインアウトし、新しいパスワードで再ログインしてもらう。
  await supabase.auth.signOut();
  redirect("/login?reset=success");
}

// ---------------------------------------------------------------------------
// ログアウト
// ---------------------------------------------------------------------------
export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
