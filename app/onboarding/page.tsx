import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProfileFormInitialValues } from "@/lib/profile/get-initial-values";
import { StylistOnboardingWizard } from "@/components/profile/stylist-onboarding-wizard";
import { hasCompletedRole } from "@/lib/auth/user-roles";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // middleware でも保護しているが、直接アクセスされた場合の保険として二重チェックする。
  if (!user) {
    redirect("/login?next=/onboarding");
  }

  // ★バグ修正: 以前はこのページ自体には完了済みかどうかのチェックが無く、
  // middlewareのバウンス処理だけに頼っていた。既に美容師roleを完了済みの
  // ユーザーが何らかの経路でこのページへ来た場合、登録済みユーザーへ再び
  // 登録フォームを見せてしまっていた。ページ自体でも user_roles を見て
  // 判定し、完了済みなら必ずマイページへ送る（登録画面を絶対に見せない）。
  if (await hasCompletedRole(supabase, user.id, "stylist")) {
    redirect("/stylist/mypage");
  }

  // ★「1 auth user = 1 role」方針: 既にsalon roleを持つユーザーが、
  // このページ経由でstylist roleを追加できないようにする（多重防御。
  // middlewareでも同様のチェックを行っている）。
  if (await hasCompletedRole(supabase, user.id, "salon")) {
    redirect("/salon/mypage");
  }

  const { initialValues } = await getProfileFormInitialValues(
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

      <h1 className="font-serif text-2xl font-bold text-ink">プロフィールを登録</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-charcoal">
        あなたの才能を正しく届けるために、プロフィールを入力してください。
        氏名・年代・性別はサロンへ自動公開されません。
      </p>

      <div className="mt-6">
        <StylistOnboardingWizard userId={user.id} initialValues={initialValues} />
      </div>
    </main>
  );
}
