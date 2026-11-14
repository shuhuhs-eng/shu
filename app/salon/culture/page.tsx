import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SalonCultureWizard } from "@/components/salon-culture/salon-culture-wizard";
import { CultureResultLoadError } from "@/components/salon-culture/culture-result-load-error";
import { loadCultureEditState } from "@/lib/salon-culture/load-edit-state";

export default async function SalonCulturePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/salon/culture");
  }

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  // サロンアカウント専用の機能。美容師アカウントの場合はマイページへ戻す。
  if (profile?.role !== "salon") {
    redirect("/stylist/mypage");
  }

  const st = await loadCultureEditState(supabase, user.id, null);
  if (st.loadError) return <CultureResultLoadError retryHref="/salon/culture" backHref="/salon/mypage" />;

  // 既に確定済みで、明示的な「見直す」（?edit=1）でない場合は結果画面へ誘導する。
  if (st.hasPublished && edit !== "1") {
    redirect("/salon/culture/result");
  }

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <h1 className="font-serif text-2xl font-bold text-ink">サロンらしさを教えてください</h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-charcoal">
        求人票では伝わらない、サロンの雰囲気や価値観を伝える質問です。今、実際にどうしているかをお答えください。
      </p>

      <div className="mt-7">
        <SalonCultureWizard
          initial={st.initial}
          initialRev={st.initialRev}
          hasPublished={st.hasPublished}
          publishedAnswers={st.publishedAnswers}
          publishedExtra={st.publishedExtra}
          limitStatus={st.limitStatus}
        />
      </div>

      <Link href="/salon/mypage" className="mt-6 block text-center text-[13px] text-sub underline">
        マイページに戻る（回答は下書きとして保存されています）
      </Link>
    </main>
  );
}
