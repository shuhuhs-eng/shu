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

  // 美容師に表示される店舗の基本情報は店舗プロフィールで編集する。取得失敗時は案内を出さない（誤案内を避ける）。
  const { data: stores, error: storesError } = await supabase
    .from("salon_stores")
    .select("id, store_name")
    .order("created_at", { ascending: true });
  const storeLinks = storesError ? [] : (stores ?? []);
  // 店舗があるときは、公開用の基本情報は店舗プロフィールで編集する（ここでは変更させない）。
  // 店舗の取得に失敗したときは、従来どおりの編集フォームを出さず、エラーを表示する。

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
        <Link href="/salon/mypage" className="text-[12px] font-semibold text-sub underline shrink-0">
          マイページへ戻る
        </Link>
      </div>

      <h1 className="font-serif text-2xl font-bold text-ink">
        {storeLinks.length > 0 ? "ロゴ・写真・リンクの編集" : "サロンプロフィール編集"}
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-charcoal">
        登録内容はいつでも変更できます。
      </p>

      {storeLinks.length > 0 && (
        <div className="mt-5 rounded-2xl border border-line bg-surface2 p-4">
          <p className="text-[13px] font-bold text-ink">美容師に表示される店舗情報は、こちらでは変わりません</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-sub">
            サロン名・所在地・紹介文などの基本情報は「店舗プロフィール」で編集します。この画面ではロゴ・写真・外部リンクだけを編集します。
          </p>
          <div className="mt-3 space-y-2">
            {storeLinks.map((st) => (
              <Link
                key={st.id}
                href={`/salon/stores/${st.id}/profile`}
                className="flex w-full items-center justify-center rounded-full border border-line bg-surface px-5 py-3 text-[13.5px] font-semibold text-ink"
              >
                店舗プロフィールを編集
                {storeLinks.length > 1 && <span className="ml-1 font-normal text-sub">（{st.store_name}）</span>}
              </Link>
            ))}
          </div>
        </div>
      )}

      {storesError ? (
        <p className="mt-6 rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] leading-relaxed text-ink">
          店舗の情報を読み込めませんでした。画面を更新してもう一度お試しください。
        </p>
      ) : (
      <div className="mt-6">
        <SalonProfileForm
          storeManaged={storeLinks.length > 0}
          mode="edit"
          userId={user.id}
          initialValues={initialValues}
          employeeSizeOptions={employeeSizeOptions}
        />
      </div>
      )}
    </main>
  );
}
