import Link from "next/link";
import { redirect } from "next/navigation";
import { CompanyBillingNav } from "@/components/billing/company-billing-nav";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { canViewCompanyBilling } from "@/lib/billing/permissions";
import { getBillingProfile } from "@/lib/invoices/actions";
import { BillingProfileForm, type BillingProfileValues } from "@/components/billing/billing-profile-form";

/**
 * 請求先の設定（/salon/company/billing-profile）。
 * ★入れる人・編集できる人: company_owner / company_admin のみ（middleware・このページ・DBの3層）。
 * recruiting_admin 以下は /salon/company へ戻す。
 */
export default async function CompanyBillingProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/salon/company/billing-profile");
  if (!(await hasCompletedRole(supabase, user.id, "salon"))) redirect("/onboarding/salon");
  if (!(await canViewCompanyBilling(supabase, user.id))) redirect("/salon/company");

  // 自分が company_owner / company_admin の会社だけ（自分の所属行はRLSで読める）。
  const { data: memberships } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .in("role", ["company_owner", "company_admin"]);
  const orgIds = Array.from(new Set((memberships ?? []).map((m) => m.organization_id)));
  const { data: orgs } = orgIds.length > 0
    ? await supabase.from("salon_organizations").select("id, name").in("id", orgIds)
    : { data: [] as Array<{ id: string; name: string }> };

  const cards = await Promise.all(
    (orgs ?? []).map(async (o) => ({ org: o, profile: await getBillingProfile(o.id) })),
  );

  return (
    <main className="mx-auto max-w-[640px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <Link href="/salon/company/billing" className="text-[13px] font-semibold text-sub underline">← 請求・成功報酬に戻る</Link>
      <CompanyBillingNav current="/salon/company/billing-profile" />
      <p className="eyebrow mb-2 mt-5">請求先の設定</p>
      <h1 className="font-serif text-2xl font-bold text-ink">請求書の宛名・住所</h1>
      <p className="mt-3 text-[13px] leading-relaxed text-charcoal">
        請求書PDFの宛名になる情報です。正式名称・郵便番号・住所が登録されていないと、請求書PDFを発行できません。
        すでに発行された請求書は、発行時点の内容のままで変わりません。
      </p>

      {cards.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-line bg-surface p-8 text-center text-[13px] text-sub">設定できる会社がありません。</p>
      ) : (
        <div className="mt-6 space-y-5">
          {cards.map(({ org, profile }) => {
            const values: BillingProfileValues = profile?.has_profile
              ? {
                  legal_name: profile.legal_name ?? "", postal_code: profile.postal_code ?? "", address: profile.address ?? "",
                  department_name: profile.department_name ?? "", contact_name: profile.contact_name ?? "", billing_email: profile.billing_email ?? "",
                }
              : { legal_name: "", postal_code: "", address: "", department_name: "", contact_name: "", billing_email: "" };
            return (
              <section key={org.id} className="rounded-2xl border border-line bg-surface p-5">
                <h2 className="font-serif text-[16px] font-bold text-ink">{org.name}</h2>
                {profile === null ? (
                  <p className="mt-3 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">請求先情報を取得できませんでした。時間をおいて再度お試しください。</p>
                ) : (
                  <>
                    {!profile.has_profile && <p className="mt-2 text-[12px] text-charcoal">請求先情報はまだ登録されていません。</p>}
                    <BillingProfileForm organizationId={org.id} initial={values} />
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
