import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSalonProfileFormInitialValues } from "@/lib/salon/get-initial-values";
import { SalonProfileForm } from "@/components/salon-profile/salon-profile-form";

/**
 * 旧URL（/salon/profile）。
 *
 * 店舗がある場合、ロゴ・写真・リンクは店舗プロフィールの編集画面
 * （/salon/stores/[storeId]/profile）へ統合したため、そちらへ案内する。
 *   ・店舗が1つ → その店舗の編集画面へ移動（ブックマークや旧リンクのため）
 *   ・店舗が複数 → どの店舗の編集画面を開くかを選んでもらう（勝手に1つへ決めない）
 *   ・店舗が無い → 従来のサロンプロフィール編集フォーム（店舗が無い間の編集先）
 *   ・店舗の取得に失敗 → エラー表示（店舗なし扱いで旧フォームを出さない）
 */
export default async function SalonProfileEditPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // middleware でも保護しているが、直接アクセスされた場合の保険として二重チェックする。
  if (!user) {
    redirect("/login?next=/salon/profile");
  }

  const { data: stores, error: storesError } = await supabase
    .from("salon_stores")
    .select("id, store_name")
    .order("created_at", { ascending: true });
  const storeLinks = storesError ? [] : (stores ?? []);

  if (storeLinks.length === 1) {
    redirect(`/salon/stores/${storeLinks[0].id}/profile`);
  }

  const header = (
    <div className="mb-7 flex items-center gap-2.5">
      <span className="eyebrow">Beauty Reach</span>
      <hr className="h-px flex-1 border-0 bg-line" />
      <Link href="/salon/mypage" className="text-[12px] font-semibold text-sub underline shrink-0">
        マイページへ戻る
      </Link>
    </div>
  );

  if (storesError) {
    return (
      <main className="mx-auto max-w-[560px] px-5 py-12">
        {header}
        <h1 className="font-serif text-2xl font-bold text-ink">店舗プロフィールを編集</h1>
        <p className="mt-6 rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] leading-relaxed text-ink">
          店舗の情報を読み込めませんでした。画面を更新してもう一度お試しください。
        </p>
      </main>
    );
  }

  if (storeLinks.length > 1) {
    return (
      <main className="mx-auto max-w-[560px] px-5 py-12">
        {header}
        <h1 className="font-serif text-2xl font-bold text-ink">店舗プロフィールを編集</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-charcoal">
          店舗の基本情報・ロゴ・写真・リンクは、店舗ごとの編集画面にまとまりました。編集する店舗を選んでください。
        </p>
        <div className="mt-6 space-y-2">
          {storeLinks.map((st) => (
            <Link
              key={st.id}
              href={`/salon/stores/${st.id}/profile`}
              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-4 text-[14px] font-semibold text-ink"
            >
              <span className="min-w-0 truncate">{st.store_name}</span>
              <span className="shrink-0 text-[12px] font-normal text-sub">編集する ›</span>
            </Link>
          ))}
        </div>
      </main>
    );
  }

  const { initialValues, employeeSizeOptions } = await getSalonProfileFormInitialValues(
    supabase,
    user.id,
    typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : null,
  );

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      {header}
      <h1 className="font-serif text-2xl font-bold text-ink">サロンプロフィール編集</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-charcoal">登録内容はいつでも変更できます。</p>
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
