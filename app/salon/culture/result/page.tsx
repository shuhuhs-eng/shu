import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CultureResult } from "@/components/salon-culture/culture-result";
import { hasAllTwelveAxes } from "@/lib/salon-culture/salon-culture-types";

export default async function SalonCultureResultPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/salon/culture/result");
  }

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  if (profile?.role !== "salon") {
    redirect("/stylist/mypage");
  }

  const { data: cultureProfile } = await supabase
    .from("salon_culture_profiles")
    .select("*")
    .eq("salon_user_id", user.id)
    .maybeSingle();

  // まだ回答が完了していない場合は、結果ではなく入力画面へ誘導する。
  if (!cultureProfile || cultureProfile.status !== "completed") {
    redirect("/salon/culture");
  }

  // ★ボタン重複の解消: 新12軸が揃っていない場合、CultureResult内に既に
  // 「サロンらしさを更新する」ボタンが表示されるため、ここでの
  // 「回答を見直す」ボタンは重複になる。12軸が揃っている場合のみ表示する。
  const hasNewAxes = hasAllTwelveAxes(cultureProfile.culture_axes ?? {});

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <CultureResult profile={cultureProfile} />

      <div className="mt-8 flex flex-col items-center gap-3">
        {hasNewAxes && (
          <Link
            href="/salon/culture?edit=1"
            className="flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-4 text-[15px] font-semibold text-ink"
          >
            回答を見直す
          </Link>
        )}
        <Link href="/salon/mypage" className="text-[13px] text-sub underline">
          マイページに戻る
        </Link>
      </div>
    </main>
  );
}
