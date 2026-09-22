import { Suspense } from "react";
import { LoginForm } from "@/app/(auth)/login/login-form";

// 美容師用ログイン入口。既存のLoginForm（認証ロジックは共通）をmode="stylist"で使う。
export default function StylistLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm mode="stylist" />
    </Suspense>
  );
}
