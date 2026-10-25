import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminSubscriptionInvoice, AdminUnissuedSubscriptionInvoice, CompanySubscriptionInvoice, AdminScoutCreditPackage, AdminStripeIssue, AdminStripeOrganizationDetail, AdminStripeOverviewRow, AdminSuccessFeePaymentRow, CompanyPaymentOverview, Database } from "@/types/database";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/security/log";

type Supa = SupabaseClient<Database>;
type FeePaymentInfo = Database["public"]["Functions"]["get_company_success_fee_payment_info"]["Returns"][number];

/** 本人が company_owner / company_admin の会社ID（請求操作の対象になりうる会社）。DBのRPCも同じ制限を重ねる。 */
export async function getBillingOrganizationIds(supabase: Supa, userId: string): Promise<string[]> {
  const { data } = await supabase.from("organization_members").select("organization_id, role").eq("user_id", userId);
  return (data ?? [])
    .filter((r) => r.role === "company_owner" || r.role === "company_admin")
    .map((r) => r.organization_id);
}

export async function getCompanyPaymentOverview(supabase: Supa, organizationId: string): Promise<CompanyPaymentOverview | null> {
  const { data, error } = await supabase.rpc("get_company_payment_overview", { p_organization_id: organizationId });
  if (error) { logError("getCompanyPaymentOverview", error); return null; }
  return data;
}

export async function getFeePaymentInfo(supabase: Supa, organizationId: string): Promise<Map<string, FeePaymentInfo> | null> {
  const { data, error } = await supabase.rpc("get_company_success_fee_payment_info", { p_organization_id: organizationId });
  if (error) { logError("getFeePaymentInfo", error); return null; }
  return new Map((data ?? []).map((r) => [r.fee_id, r]));
}

async function adminRpc<T>(where: string, call: (s: Supa) => PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>): Promise<T | null> {
  const supabase = await createClient();
  const { data, error } = await call(supabase);
  if (error) { logError(where, error); return null; }
  return data;
}

export const getAdminStripeOverview = (): Promise<AdminStripeOverviewRow[] | null> =>
  adminRpc("getAdminStripeOverview", (s) => s.rpc("get_admin_stripe_overview"));
export const getAdminStripeOrganizationDetail = (organizationId: string): Promise<AdminStripeOrganizationDetail | null> =>
  adminRpc("getAdminStripeOrganizationDetail", (s) => s.rpc("get_admin_stripe_organization_detail", { p_organization_id: organizationId }));
export const getAdminSuccessFeePayments = (): Promise<AdminSuccessFeePaymentRow[] | null> =>
  adminRpc("getAdminSuccessFeePayments", (s) => s.rpc("get_admin_success_fee_payments"));
export const getAdminStripeIssues = (includeResolved = false): Promise<AdminStripeIssue[] | null> =>
  adminRpc("getAdminStripeIssues", (s) => s.rpc("get_admin_stripe_integrity_issues", { p_include_resolved: includeResolved }));
export const getAdminScoutCreditPackages = (): Promise<AdminScoutCreditPackage[] | null> =>
  adminRpc("getAdminScoutCreditPackages", (s) => s.rpc("get_admin_scout_credit_packages"));

export async function getCompanySubscriptionInvoices(supabase: Supa, organizationId: string): Promise<CompanySubscriptionInvoice[] | null> {
  const { data, error } = await supabase.rpc("get_company_subscription_invoices", { p_organization_id: organizationId });
  if (error) { logError("getCompanySubscriptionInvoices", error); return null; }
  return data;
}
export const getAdminSubscriptionInvoices = (): Promise<AdminSubscriptionInvoice[] | null> =>
  adminRpc("getAdminSubscriptionInvoices", (s) => s.rpc("get_admin_subscription_invoices", { p_organization_id: null }));
export const getAdminUnissuedSubscriptionInvoices = (): Promise<AdminUnissuedSubscriptionInvoice[] | null> =>
  adminRpc("getAdminUnissuedSubscriptionInvoices", (s) => s.rpc("get_admin_unissued_subscription_invoices"));
