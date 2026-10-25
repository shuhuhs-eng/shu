import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAdminStripeOrganizationDetail } from "@/lib/stripe/queries";
import { CHECKOUT_PURPOSE_LABELS, CHECKOUT_STATUS_LABELS } from "@/lib/stripe/admin-labels";
import { subscriptionStateLabel } from "@/lib/stripe/labels";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

/**
 * 会社ごとのStripe詳細（/admin/stripe/[organizationId]）。運営者のみ。
 * Stripe技術ID（顧客・サブスクリプション・決済のID）を確認できるのはこの画面だけ。
 * 読み取り専用で、Stripeの状態を変更する操作は置かない（変更はStripeダッシュボードで行う）。
 */
export default async function AdminStripeOrganizationPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  if (!z.string().uuid().safeParse(organizationId).success) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/admin/stripe/${organizationId}`);
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) redirect("/mypage");

  const d = await getAdminStripeOrganizationDetail(organizationId);
  return (
    <main className="mx-auto max-w-[760px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach Admin</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <Link href="/admin/stripe" className="text-[13px] font-semibold text-sub underline">← カード決済</Link>
      <h1 className="mt-4 font-serif text-2xl font-bold text-ink">Stripe詳細</h1>
      {d === null ? (
        <p className="mt-6 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">取得できませんでした。</p>
      ) : (
        <>
          <dl className="mt-6 grid gap-3 rounded-2xl border border-line bg-surface p-5 text-[12px] sm:grid-cols-2">
            <div><dt className="text-sub">Stripe顧客ID</dt><dd className="break-all font-mono text-charcoal">{d.stripe_customer_id ?? "未作成"}</dd></div>
            <div><dt className="text-sub">環境</dt><dd>{d.livemode === null ? "—" : d.livemode ? "本番(live)" : "テスト"}</dd></div>
            <div><dt className="text-sub">カード</dt><dd>{d.payment_method_available ? "登録済" : "未登録"}（確認 {fmt(d.payment_method_checked_at)}）</dd></div>
            <div><dt className="text-sub">月額の決済状態</dt><dd>{subscriptionStateLabel(d.payment_state)}（Stripe: {d.subscription_status ?? "—"}）</dd></div>
            <div className="sm:col-span-2"><dt className="text-sub">サブスクリプションID</dt><dd className="break-all font-mono text-charcoal">{d.stripe_subscription_id ?? "なし"}</dd></div>
            <div><dt className="text-sub">最終同期</dt><dd>{fmt(d.synced_at)}</dd></div>
          </dl>
          <h2 className="mt-8 font-serif text-[16px] font-bold text-ink">最近の決済手続き</h2>
          {d.recent_checkouts.length === 0 ? <p className="mt-2 text-[12px] text-sub">まだありません。</p> : (
            <ul className="mt-2 space-y-2">
              {d.recent_checkouts.map((c) => (
                <li key={c.record_id} className="rounded-xl border border-line bg-surface p-3 text-[12px]">
                  <p className="font-semibold text-ink">{CHECKOUT_PURPOSE_LABELS[c.purpose] ?? c.purpose}　<span className="text-sub">{CHECKOUT_STATUS_LABELS[c.status] ?? c.status}</span>
                    {c.expected_amount !== null && <>　{c.expected_amount.toLocaleString("ja-JP")}円（税込）{c.amount_excl_tax !== null && c.tax_amount !== null && <span className="text-sub">　税抜 {c.amount_excl_tax.toLocaleString("ja-JP")} ＋ 税 {c.tax_amount.toLocaleString("ja-JP")}（{c.tax_rate}%）</span>}</>}{c.credits !== null && <>　{c.credits}件</>}</p>
                  <p className="mt-0.5 text-[11px] text-sub">開始 {fmt(c.created_at)} ／ 完了 {fmt(c.completed_at)}</p>
                  {c.stripe_checkout_session_id && <p className="mt-0.5 break-all font-mono text-[10.5px] text-sub">{c.stripe_checkout_session_id}</p>}
                  {c.stripe_payment_intent_id && <p className="break-all font-mono text-[10.5px] text-sub">{c.stripe_payment_intent_id}</p>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
