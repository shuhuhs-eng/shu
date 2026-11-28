import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/guard";
import { salonAccountIssueEnabled } from "@/lib/billing/hire-flags";
import { SalonSignupPolicy } from "@/components/admin/salon-signup-policy";
import { SalonIssueForm, type IssuanceRow } from "@/components/admin/salon-issue-form";

/** 運営（責任者のみ）: サロンアカウントの発行と登録区分の選択。SALON_ACCOUNT_ISSUE_ENABLED=1 のときだけ使える（既定オフ）。 */
export default async function SalonIssuePage() {
  const { supabase } = await requireAdminPage("/admin/salons/issue");
  const head = <><Link href="/admin/salons" className="text-[13px] font-semibold text-sub underline">← 会社・店舗</Link><h1 className="mt-4 font-serif text-2xl font-bold text-ink">サロンアカウントの発行</h1></>;
  if (!salonAccountIssueEnabled()) return <main className="mx-auto max-w-[900px] px-5 py-10">{head}<p className="mt-3 text-[12.5px] text-sub">この機能はまだ有効になっていません。</p></main>;
  const { data, error } = await (supabase as unknown as { rpc: (n: string, a: object) => Promise<{ data: unknown; error: unknown }> }).rpc("admin_salon_issuances_list", { p_limit: 50 });
  const pol = await (supabase as unknown as { rpc: (n: string, a: object) => Promise<{ data: unknown; error: unknown }> }).rpc("admin_salon_signup_policy", {});
  const issuedOnly = pol.error || !pol.data ? null : (pol.data as { issued_only?: boolean }).issued_only === true;
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      {head}
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">本部がサロンのアカウントを作り、登録区分（通常登録／キャンペーン登録）を選びます。サロン担当者にはパスワード設定のメールが届きます。</p>
      {error ? <p role="alert" className="mt-4 text-[12.5px] text-[#8A2E2E]">発行の状況を取得できませんでした。</p> : null}
      <SalonSignupPolicy issuedOnly={issuedOnly} />
      <SalonIssueForm rows={Array.isArray(data) ? (data as IssuanceRow[]) : []} />
    </main>
  );
}
