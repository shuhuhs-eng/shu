import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { getMyHiringProcesses } from "@/lib/hiring/actions";
import { StylistApplicationCard } from "@/components/hiring/stylist-application-card";

/**
 * 美容師の「選考状況」（/stylist/applications、Phase 8）。
 *
 * ★データはget_my_hiring_processes()のみ（本人の分だけ）。RPCが店舗名・
 * 状況・面談・店舗からの案内・公開履歴だけを返し、社内メモ・理由・
 * スタッフのIDは返さない。店舗が非公開に変わっていても、選考という接点が
 * あるため店舗名を表示する。
 */
export default async function StylistApplicationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/stylist/applications");
  }

  if (!(await hasCompletedRole(supabase, user.id, "stylist"))) {
    redirect("/onboarding");
  }

  const processes = await getMyHiringProcesses();

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <Link href="/stylist/mypage" className="text-[13px] font-semibold text-sub underline">
        ← マイページに戻る
      </Link>

      <p className="eyebrow mb-2 mt-5">選考状況</p>
      <h1 className="font-serif text-2xl font-bold text-ink">店舗との選考の進み具合</h1>
      <p className="mt-3 text-[13px] leading-relaxed text-charcoal">
        店舗が面談・選考を進めている内容です。店舗が登録した美容師の分だけ表示されます。
      </p>

      {processes === null ? (
        <p className="mt-8 text-center text-[13px] text-sub">選考状況を取得できませんでした。時間をおいて再度お試しください。</p>
      ) : processes.length === 0 ? (
        <p className="mt-8 text-center text-[13px] text-sub">現在、進行中の選考はありません。</p>
      ) : (
        <div className="mt-6 space-y-4">
          {processes.map((p) => (
            <StylistApplicationCard key={p.process_id} process={p} />
          ))}
        </div>
      )}

      <Link
        href="/stylist/salons"
        className="mt-8 flex w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-3.5 text-[14px] font-semibold text-ink"
      >
        公開中の店舗を探す
      </Link>
    </main>
  );
}
