import { Suspense } from "react";
import { LoginForm } from "@/app/(auth)/login/login-form";

// サロン用ログイン入口。既存のLoginForm（認証ロジックは共通）をmode="salon"で使う。
export default function SalonLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm mode="salon" />
    </Suspense>
  );
}
