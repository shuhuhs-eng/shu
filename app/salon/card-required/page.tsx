import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSalonCardGate } from "@/lib/billing/salon-card-gate";
import { NOINDEX_METADATA } from "@/lib/seo/metadata";

export const metadata = NOINDEX_METADATA;
export const dynamic = "force-dynamic";

/**
 * カード未登録のサロン担当者への案内（業務機能は使えない）。カードを登録できる人（オーナー/管理者）には登録画面への入口を出す。
 * 登録済み、または制御が無効（DBの設定が false）のときは、通常のマイページへ戻す。確認できないときは、その旨を表示する。
 */
export default async function SalonCardRequiredPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/salon/login");
  const gate = await getSalonCardGate(supabase);
  if (!gate.blocked) redirect("/salon/mypage");
  return (
    <main className="mx-auto max-w-[560px] px-5 py-14">
      <p className="eyebrow mb-2">Beauty Reach</p>
      <h1 className="font-serif text-2xl font-bold text-ink">カードの登録が必要です</h1>
      {gate.unknown ? (
        <p role="alert" className="mt-4 text-[13px] leading-relaxed text-charcoal">カードの登録状況を確認できませんでした。時間をおいて、もう一度お試しください。</p>
      ) : (
        <p className="mt-4 text-[13px] leading-relaxed text-charcoal">
          サロンのご利用には、会社のクレジットカードの登録が必要です。登録が完了するまで、採用・メッセージなどの業務機能はご利用いただけません。
        </p>
      )}
      {gate.canRegister ? (
        <Link href="/salon/company/billing?card=required" className="mt-6 inline-block rounded-full bg-ink px-5 py-3 text-[13px] font-semibold text-white">カードを登録する</Link>
      ) : (
        !gate.unknown && <p className="mt-4 text-[13px] leading-relaxed text-sub">カードの登録は、会社のオーナーまたは管理者が行えます。お手数ですが、依頼してください。</p>
      )}
      <p className="mt-8 text-[12px] text-sub">請求先情報と契約内容は、登録前でもご確認いただけます。</p>
      <div className="mt-2 flex gap-4 text-[12.5px] font-semibold underline"><Link href="/salon/company/billing-profile">請求先情報</Link><Link href="/salon/company/contract">契約内容</Link></div>
    </main>
  );
}
