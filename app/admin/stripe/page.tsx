import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminScoutCreditPackages, getAdminStripeIssues, getAdminStripeOverview, getAdminSuccessFeePayments } from "@/lib/stripe/queries";
import { ISSUE_TYPE_LABELS, SYNC_FLAG_LABELS } from "@/lib/stripe/admin-labels";
import { subscriptionStateLabel } from "@/lib/stripe/labels";
import { StripeIssueResolve } from "@/components/admin/stripe-issue-resolve";
import { ScoutPackageForm } from "@/components/admin/scout-package-form";

const yen = (n: number | null) => (n === null ? "未確定" : `${n.toLocaleString("ja-JP")}円`);
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });
}
const ERR = "rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]";

/**
 * カード決済の状況（/admin/stripe、Phase 48）。運営者(is_platform_admin)のみ。
 * ★Stripe技術ID（cus_/sub_/cs_/pi_/evt_）はこの一覧には出さない。会社別の詳細画面のみで表示する。
 * ★状態の自動修復はしない。不整合は内容を確認し、Stripeダッシュボード等で対応したうえで「対応済み」を記録する。
 */
export default async function AdminStripePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/stripe");
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) redirect("/mypage");

  const [overview, payments, issues, packages] = await Promise.all([
    getAdminStripeOverview(), getAdminSuccessFeePayments(), getAdminStripeIssues(false), getAdminScoutCreditPackages(),
  ]);

  return (
    <main className="mx-auto max-w-[900px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach Admin</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <Link href="/admin" className="text-[13px] font-semibold text-sub underline">← 運営ダッシュボード</Link>
      <h1 className="mt-4 font-serif text-2xl font-bold text-ink">カード決済</h1>
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">
        月額のカード自動課金、成功報酬のカード払い、追加スカウト枠の状況です。銀行振込の入金確認は従来どおり「成功報酬・請求」から行います。
      </p>

      <section className="mt-8">
        <h2 className="font-serif text-[18px] font-bold text-ink">要対応（Stripeとの不整合）</h2>
        {issues === null ? <p className={`mt-3 ${ERR}`}>取得できませんでした。</p> : issues.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-line bg-surface p-5 text-[13px] text-sub">現在、対応が必要な項目はありません。</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {issues.map((i) => (
              <li key={i.issue_id} className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-[13px] font-bold text-ink">
                  <span className={`mr-2 rounded-full px-2 py-0.5 text-[10.5px] ${i.severity === "critical" ? "bg-[#C24545]/10 text-[#8A2E2E]" : "bg-[#B7791F]/10 text-[#8A5A12]"}`}>{i.severity === "critical" ? "要対応" : "要確認"}</span>
                  {ISSUE_TYPE_LABELS[i.issue_type] ?? i.issue_type}
                </p>
                <p className="mt-1 text-[11.5px] text-sub">{i.organization_name ?? "会社不明"} ／ {fmtDate(i.created_at)}</p>
                {i.detail && <p className="mt-1 text-[12px] text-charcoal">{i.detail}</p>}
                {i.organization_id && <p className="mt-1 text-[11.5px]"><Link className="underline" href={`/admin/stripe/${i.organization_id}`}>会社の詳細（Stripe ID）を見る</Link></p>}
                <StripeIssueResolve issueId={i.issue_id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-[18px] font-bold text-ink">会社ごとの月額・カード状況</h2>
        {overview === null ? <p className={`mt-3 ${ERR}`}>取得できませんでした。</p> : (
          <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[720px] text-left text-[12px]">
              <thead className="border-b border-line text-[11px] text-sub"><tr>
                <th className="p-3">会社</th><th className="p-3">契約</th><th className="p-3">月額（契約・税抜）</th><th className="p-3">顧客作成</th><th className="p-3">カード</th><th className="p-3">月額の決済状態</th><th className="p-3">次回/最終</th>
              </tr></thead>
              <tbody>
                {overview.map((o) => (
                  <tr key={o.organization_id} className="border-b border-line/60 align-top">
                    <td className="p-3"><Link className="font-semibold underline" href={`/admin/stripe/${o.organization_id}`}>{o.organization_name ?? "（名称未設定）"}</Link>
                      {o.open_issue_count > 0 && <span className="ml-1.5 rounded-full bg-[#C24545]/10 px-2 py-0.5 text-[10px] font-bold text-[#8A2E2E]">要対応 {o.open_issue_count}</span>}</td>
                    <td className="p-3">{o.contract_status ?? "未設定"}</td>
                    <td className="p-3">{yen(o.contract_monthly_fee)}{o.subscription_total_amount !== null && <span className="block text-[11px] text-sub">課金 税込 {yen(o.subscription_total_amount)}</span>}</td>
                    <td className="p-3">{o.customer_created ? "済" : "未"}</td>
                    <td className="p-3">{o.payment_method_available ? "登録済" : "未登録"}</td>
                    <td className="p-3">{subscriptionStateLabel(o.subscription_payment_state)}
                      {o.sync_flags.length > 0 && (
                        <ul className="mt-1 list-disc pl-4 text-[11px] text-[#8A5A12]">{o.sync_flags.map((f) => <li key={f}>{SYNC_FLAG_LABELS[f] ?? f}</li>)}</ul>
                      )}</td>
                    <td className="p-3 text-[11px] text-sub">次回 {fmtDate(o.current_period_end)}<br />最終成功 {fmtDate(o.last_payment_at)}<br />最終失敗 {fmtDate(o.last_payment_failed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-[18px] font-bold text-ink">成功報酬の支払い方法</h2>
        {payments === null ? <p className={`mt-3 ${ERR}`}>取得できませんでした。</p> : payments.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-line bg-surface p-5 text-[13px] text-sub">請求済み・入金済みの成功報酬はまだありません。</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[640px] text-left text-[12px]">
              <thead className="border-b border-line text-[11px] text-sub"><tr>
                <th className="p-3">会社</th><th className="p-3">請求書番号</th><th className="p-3">金額（税込）</th><th className="p-3">状態</th><th className="p-3">入金方法</th><th className="p-3">カード手続き</th>
              </tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.fee_id} className="border-b border-line/60">
                    <td className="p-3">{p.organization_name ?? "—"}</td>
                    <td className="p-3">{p.invoice_number ?? "—"}</td>
                    <td className="p-3">{yen(p.total_amount)}</td>
                    <td className="p-3">{p.fee_status === "paid" ? `入金済み（${fmtDate(p.paid_at)}）` : "請求済み"}</td>
                    <td className="p-3">{p.payment_method === "card" ? "カード" : p.payment_method === "bank_transfer" ? "銀行振込" : "—"}</td>
                    <td className="p-3 text-[11px] text-sub">{p.card_checkout_status ?? "—"}{p.open_issue_count > 0 ? "（要対応あり）" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-[18px] font-bold text-ink">追加スカウト枠の商品</h2>
        <p className="mt-1 text-[11.5px] leading-relaxed text-sub">件数と価格は事業判断です。ここで設定し「購入を許可」にするまで、会社側からは購入できません（決済の確認後にだけ枠が追加されます）。</p>
        {packages === null ? <p className={`mt-3 ${ERR}`}>取得できませんでした。</p> : (
          <div className="mt-3 space-y-3 rounded-2xl border border-line bg-surface p-4">
            {packages.map((p) => <ScoutPackageForm key={p.package_id} pkg={p} />)}
            <div><p className="text-[12px] font-semibold text-ink">新しい商品を追加</p><ScoutPackageForm /></div>
          </div>
        )}
      </section>
    </main>
  );
}
