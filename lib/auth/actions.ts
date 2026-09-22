"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site-url";
import { mapAuthError } from "@/lib/auth/errors";
import { determinePostAuthPath, determineRoleEntryPath } from "@/lib/auth/post-auth-redirect";
import { claimPendingDiagnosisIfPresent } from "@/lib/diagnosis-handoff/claim";
import {
  signUpSchema,
  loginSchema,
  requestResetSchema,
  updatePasswordSchema,
} from "@/lib/validation/auth";
import type { AuthActionState } from "@/lib/auth/types";

/** "/" 始まり・"//" で始まらない内部パスのみ許可する（オープンリダイレクト対策）。 */
function safeInternalPath(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

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
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${getSiteUrl()}/auth/callback`,
      data: { display_name: displayName, role },
    },
  });

  if (error) {
    return { error: mapAuthError(error.message) };
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

  return {
    success:
      "確認メールを送信しました。数分待ってもメールが届かない場合は、すでに登録済みのメールアドレスである可能性があります。ログインまたはパスワードを再設定してください。",
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
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: mapAuthError(error.message) };
  }

  // 未ログイン時に受けた診断結果があれば、ここで本人アカウントへ紐づける。
  // 失敗してもログイン処理自体は継続する（ベストエフォート）。
  await claimPendingDiagnosisIfPresent();

  // 保護ルートから弾かれてログインに来た場合は、元のURLへ戻す（安全なパスのみ）。
  const next = safeInternalPath(formData.get("next"));
  if (next) {
    console.log("[signInAction] redirecting to next param", { next });
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
      console.log("[signInAction] redirecting via determineRoleEntryPath", { userId: user.id, entryMode, dest });
      redirect(dest);
    }

    const dest = await determinePostAuthPath(supabase, user.id);
    console.log("[signInAction] redirecting via determinePostAuthPath", { userId: user.id, dest });
    redirect(dest);
  }

  console.log("[signInAction] no user after getUser(), redirecting to /");
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

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${getSiteUrl()}/auth/callback?next=/update-password`,
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
    return { error: mapAuthError(error.message) };
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
