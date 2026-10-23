import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAdminOrganizationContract } from "@/lib/contracts/actions";
import { describeEventChanges, eventTypeLabel, formatDateTime } from "@/lib/contracts/format";
import { ContractEditForm } from "@/components/contracts/contract-edit-form";

type Props = { params: Promise<{ organizationId: string }> };

/**
 * 運営者向けの契約管理（1社）。編集は運営者のみ（権限の本体はRPC）。
 * 履歴は日時・変更種別・変更内容・理由のみ。操作者のIDは画面に出さない。
 */
export default async function AdminCompanyContractPage({ params }: Props) {
  const { organizationId } = await params;
  if (!z.string().uuid().safeParse(organizationId).success) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/admin/companies/${organizationId}/contract`);
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) redirect("/mypage");

  const detail = await getAdminOrganizationContract(organizationId);
  if (detail === null) notFound();

  return (
    <main className="mx-auto max-w-[760px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach Admin</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <Link href={`/admin/companies/${organizationId}`} className="text-[13px] font-semibold text-sub underline">← {detail.organization_name}</Link>
      <h1 className="mt-4 font-serif text-2xl font-bold text-ink">契約条件</h1>
      <p className="mt-1 text-[13px] text-charcoal">{detail.organization_name}</p>
      {detail.contract === null && <p className="mt-3 rounded-lg bg-surface2 px-3 py-2 text-[12px] text-charcoal">契約条件未設定です。</p>}

      <div className="mt-6"><ContractEditForm detail={detail} /></div>

      <section className="mt-10">
        <p className="eyebrow mb-3">変更の履歴</p>
        {detail.events.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface p-6 text-center text-[13px] text-sub">まだ履歴はありません。</p>
        ) : (
          <div className="space-y-2">
            {detail.events.map((e, idx) => {
              const lines = describeEventChanges(e);
              return (
                <div key={`${e.created_at}-${idx}`} className="rounded-2xl border border-line bg-surface p-4 text-[12px]">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-ink">{eventTypeLabel(e.event_type)}</p>
                    <p className="text-[11px] text-sub">{formatDateTime(e.created_at)}</p>
                  </div>
                  {lines.length > 0 && <ul className="mt-1.5 space-y-0.5 text-charcoal">{lines.map((l) => <li key={l}>{l}</li>)}</ul>}
                  {e.note && <p className="mt-1.5 text-charcoal">理由：{e.note}</p>}
                  <p className="mt-1.5 text-[10.5px] text-sub">運営者による変更</p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
