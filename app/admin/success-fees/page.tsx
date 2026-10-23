import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminSuccessFees } from "@/lib/billing/actions";
import { SuccessFeeCard } from "@/components/admin/success-fee-card";

/**
 * 運営者向けの成功報酬管理（/admin/success-fees）。
 * ★運営者(is_platform_admin)以外は入れない。RPCも運営者以外を拒否する。
 */
export default async function AdminSuccessFeesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/success-fees");
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) redirect("/mypage");

  const fees = await getAdminSuccessFees();
  if (fees === null) throw new Error("成功報酬の一覧を取得できませんでした。");

  const open = fees.filter((f) => ["pending_confirmation", "confirmed", "invoiced"].includes(f.fee_status));
  const closed = fees.filter((f) => !open.includes(f));

  return (
    <main className="mx-auto max-w-[760px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach Admin</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <Link href="/admin" className="text-[13px] font-semibold text-sub underline">← 運営ダッシュボード</Link>
      <h1 className="mt-4 font-serif text-2xl font-bold text-ink">成功報酬の管理</h1>
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">
        採用が成立すると自動で「請求確認中」の記録ができます。金額・税額は契約内容に従って入力してください（整数円）。免除・取消には理由が必要です。ここでは請求書の発行や決済は行いません。
      </p>

      <h2 className="mt-8 font-serif text-base font-bold text-ink">対応が必要・進行中（{open.length}件）</h2>
      <div className="mt-3 space-y-5">
        {open.length > 0 ? open.map((f) => <SuccessFeeCard key={f.fee_id} fee={f} />) : <p className="rounded-2xl border border-line bg-surface p-8 text-center text-[13px] text-sub">対応が必要な成功報酬はありません。</p>}
      </div>

      {closed.length > 0 && (
        <>
          <h2 className="mt-10 font-serif text-base font-bold text-ink">完了・終了（{closed.length}件）</h2>
          <div className="mt-3 space-y-5">{closed.map((f) => <SuccessFeeCard key={f.fee_id} fee={f} />)}</div>
        </>
      )}
    </main>
  );
}
