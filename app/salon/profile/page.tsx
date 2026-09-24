import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSalonProfileFormInitialValues } from "@/lib/salon/get-initial-values";
import { SalonProfileForm } from "@/components/salon-profile/salon-profile-form";

export default async function SalonProfileEditPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // middleware でも保護しているが、直接アクセスされた場合の保険として二重チェックする。
  if (!user) {
    redirect("/login?next=/salon/profile");
  }

  const { initialValues, employeeSizeOptions } = await getSalonProfileFormInitialValues(
    supabase,
    user.id,
    typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : null,
  );

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
        <Link href="/salon/mypage" className="text-[12px] font-semibold text-sub underline shrink-0">
          マイページへ戻る
        </Link>
      </div>

      <h1 className="font-serif text-2xl font-bold text-ink">サロンプロフィール編集</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-charcoal">
        登録内容はいつでも変更できます。
      </p>

      <div className="mt-6">
        <SalonProfileForm
          mode="edit"
          userId={user.id}
          initialValues={initialValues}
          employeeSizeOptions={employeeSizeOptions}
        />
      </div>
    </main>
  );
}
