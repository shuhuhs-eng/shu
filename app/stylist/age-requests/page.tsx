import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { AgeRequestCard } from "@/components/age-disclosure/age-request-card";

/**
 * 美容師の「実年齢の開示依頼」一覧。依頼元の店舗を確認して、承認・辞退を選べる（本人のみ。他人の依頼は見えない）。
 * データは get_my_age_disclosure_requests のみ（DB側で本人宛だけを返す）。
 */
export default async function StylistAgeRequestsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/stylist/age-requests");
  if (!(await hasCompletedRole(supabase, user.id, "stylist"))) redirect("/onboarding");

  const { data, error } = await supabase.rpc("get_my_age_disclosure_requests");
  if (error) console.error("[StylistAgeRequestsPage] RPC failed", { message: error.message, code: error.code });
  const requests = data ?? [];

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>
      <Link href="/stylist/mypage" className="text-[13px] font-semibold text-sub underline">
        ← マイページに戻る
      </Link>
      <p className="eyebrow mb-2 mt-5">年齢の開示依頼</p>
      <h1 className="font-serif text-2xl font-bold text-ink">実年齢の開示依頼</h1>
      <p className="mt-3 text-[13px] leading-relaxed text-charcoal">
        年代で表示している場合、サロンから実年齢の開示を依頼されることがあります。承認した店舗にだけ現在の満年齢が表示されます。生年月日は公開されません。
      </p>

      {error ? (
        <p className="mt-8 text-center text-[13px] text-sub">一覧を取得できませんでした。時間をおいて再度お試しください。</p>
      ) : requests.length === 0 ? (
        <p className="mt-8 text-center text-[13px] text-sub">現在、届いている依頼はありません。</p>
      ) : (
        <div className="mt-6 space-y-3">
          {requests.map((r) => (
            <AgeRequestCard
              key={r.request_id}
              requestId={r.request_id}
              storeName={r.store_name}
              location={[r.prefecture, r.city].filter(Boolean).join(" ") || null}
              requestedAt={r.requested_at}
              decidedAt={r.decided_at}
              status={r.status}
            />
          ))}
        </div>
      )}
    </main>
  );
}
