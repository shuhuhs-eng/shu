import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSalonProfileFormInitialValues } from "@/lib/salon/get-initial-values";
import { SalonProfileForm } from "@/components/salon-profile/salon-profile-form";
import { hasCompletedRole } from "@/lib/auth/user-roles";

export default async function SalonOnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // middleware でも保護しているが、直接アクセスされた場合の保険として二重チェックする。
  if (!user) {
    redirect("/login?next=/onboarding/salon");
  }

  // ★バグ修正: サロンroleを完了済みのユーザーには絶対に登録フォームを見せない。
  if (await hasCompletedRole(supabase, user.id, "salon")) {
    redirect("/salon/mypage");
  }

  // ★「1 auth user = 1 role」方針: 既にstylist roleを持つユーザーが、
  // このページ経由でsalon roleを追加できないようにする（多重防御。
  // middlewareでも同様のチェックを行っている）。
  if (await hasCompletedRole(supabase, user.id, "stylist")) {
    redirect("/stylist/mypage");
  }

  const { initialValues, employeeSizeOptions } = await getSalonProfileFormInitialValues(
    supabase,
    user.id,
    typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : null,
  );

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <Link href="/" className="text-[12.5px] font-semibold text-sub underline shrink-0">
          ← Beauty Reachトップへ
        </Link>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <h1 className="font-serif text-2xl font-bold text-ink">サロンプロフィールを登録</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-charcoal">
        美容師とのマッチング精度を高めるために、サロンのプロフィールを入力してください。
      </p>

      <div className="mt-6">
        <SalonProfileForm
          mode="create"
          userId={user.id}
          initialValues={initialValues}
          employeeSizeOptions={employeeSizeOptions}
        />
      </div>
    </main>
  );
}
