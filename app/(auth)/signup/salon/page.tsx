import Link from "next/link";
import { salonSelfSignupClosed, SALON_SIGNUP_CLOSED_MESSAGE } from "@/lib/auth/salon-signup";
import { SalonSignupForm } from "./salon-signup-form";

export const dynamic = "force-dynamic";

/** サロンの一般新規登録。本部発行（招待）に切り替えた後は、案内だけを表示する。 */
export default function SignUpSalonPage() {
  if (salonSelfSignupClosed()) {
    return (
      <div className="space-y-5">
        <h1 className="font-serif text-2xl font-bold text-ink">サロンの新規登録</h1>
        <p role="status" className="rounded-2xl border border-line bg-surface p-4 text-[13px] leading-relaxed">{SALON_SIGNUP_CLOSED_MESSAGE}</p>
        <p className="text-[13px] text-sub">招待メールを受け取った方は、メール内のリンクからパスワードを設定してください。設定済みの方は <Link href="/salon/login" className="underline">ログイン</Link> へ。</p>
        <p className="text-[13px] text-sub">美容師の方は <Link href="/signup" className="underline">こちら</Link></p>
      </div>
    );
  }
  return <SalonSignupForm />;
}
