import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getIssuerSettings, type IssuerSettingsInput } from "@/lib/invoices/actions";
import { IssuerSettingsForm } from "@/components/admin/issuer-settings-form";

/**
 * 請求書の発行事業者・振込先の設定（/admin/issuer-settings）。platform adminのみ。
 * 発行済みの請求書PDFは発行時点の内容で固定されるため、ここを変えても過去の請求書は変わらない。
 */
export default async function AdminIssuerSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/issuer-settings");
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) redirect("/mypage");

  const settings = await getIssuerSettings();
  const initial: IssuerSettingsInput = {
    legal_name: "", postal_code: "", address: "", invoice_registration_number: "", phone: "", email: "",
    bank_name: "", bank_branch_name: "", bank_account_type: "", bank_account_number: "", bank_account_holder: "",
  };
  if (settings?.has_settings) {
    initial.legal_name = settings.legal_name ?? "";
    initial.postal_code = settings.postal_code ?? "";
    initial.address = settings.address ?? "";
    initial.invoice_registration_number = settings.invoice_registration_number ?? "";
    initial.phone = settings.phone ?? "";
    initial.email = settings.email ?? "";
    initial.bank_name = settings.bank_name ?? "";
    initial.bank_branch_name = settings.bank_branch_name ?? "";
    initial.bank_account_number = settings.bank_account_number ?? "";
    initial.bank_account_holder = settings.bank_account_holder ?? "";
    const t = settings.bank_account_type;
    initial.bank_account_type = t === "ordinary" || t === "checking" || t === "savings" ? t : "";
  }

  return (
    <main className="mx-auto max-w-[640px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach Admin</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <Link href="/admin/success-fees" className="text-[13px] font-semibold text-sub underline">← 成功報酬の管理</Link>
      <h1 className="mt-4 font-serif text-2xl font-bold text-ink">請求書の発行事業者・振込先</h1>
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">
        請求書PDFに記載される、発行事業者の情報と振込先です。すべて入力されていないと請求書PDFは発行できません。
        発行済みの請求書は発行時点の内容で固定され、ここを変更しても過去の請求書は変わりません。
      </p>
      {settings === null && (
        <p className="mt-4 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">現在の設定を取得できませんでした。画面を更新してください。</p>
      )}
      {settings !== null && <IssuerSettingsForm initial={initial} />}
    </main>
  );
}
