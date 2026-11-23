import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminStatus } from "@/lib/admin/is-admin";
import { getOperatorState } from "@/lib/admin/operator";
import { isStaffState, operatorHomePath } from "@/lib/admin/operator-state";
import { LoginForm } from "@/app/(auth)/login/login-form";

/**
 * 管理者専用ログイン入口。既存のLoginForm・signInAction（認証・レート制限・CAPTCHAは共通）を mode="admin" で使う。
 * ★ここに入れるかどうかではなく、ログイン後に is_platform_admin() で管理者だけを /admin へ進める
 *   （画面の表示でアクセスを制御しない。/admin 配下の各ページとDBのRPCが権限を確認する）。
 * すでに管理者としてログイン中なら /admin へ。
 */
export default async function AdminLoginPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user && (await getAdminStatus(supabase)) === "admin") redirect("/admin");
  if (user) {
    // スタッフ: 有効・招待中・停止中は状態の画面へ。再ログイン待ちはここでログインし直す（フォームを出す）。
    const op = await getOperatorState(supabase);
    const home = operatorHomePath(op);
    if (isStaffState(op) && op !== "staff_relogin" && home) redirect(home);
  }
  return (
    <Suspense fallback={null}>
      <LoginForm mode="admin" />
    </Suspense>
  );
}
