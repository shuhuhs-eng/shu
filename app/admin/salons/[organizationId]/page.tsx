import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/guard";
import { getOrganization } from "@/lib/admin/directory";
import { ErrorBox, PersonLine, Where, VIS_LABEL, USAGE_LABEL } from "@/components/admin/directory-ui";

/** 運営: 会社詳細（全店舗・登録担当者）。会社の所在地と各店舗の所在地は区別する。読み取り専用。 */
export default async function AdminSalonDetailPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const { supabase } = await requireAdminPage(`/admin/salons/${organizationId}`);
  const res = await getOrganization(supabase, organizationId);
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <Link href="/admin/salons" className="text-[13px] font-semibold text-sub underline">← 会社・店舗</Link>
      {!res.ok ? <ErrorBox reason={res.reason} /> : (() => {
        const d = res.data;
        return (
          <>
            <h1 className="mt-4 break-words font-serif text-2xl font-bold text-ink">{d.organization.name}</h1>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12.5px]">
              <dt className="text-sub">会社の所在地</dt><dd className="text-sub">未設定（会社単位の所在地は未登録）</dd>
              <dt className="text-sub">状態</dt><dd>{d.organization.status}</dd>
              <dt className="text-sub">採用の進行</dt><dd>{d.hiring_process_count}件</dd>
            </dl>
            <h2 className="mt-8 font-serif text-lg font-bold text-ink">登録担当者（会社の権限）</h2>
            <ul className="mt-2 space-y-2 rounded-2xl border border-line bg-surface p-4">
              {d.members.length === 0 ? <li className="text-[12.5px] text-sub">登録担当者はいません。</li> : d.members.map((m) => <PersonLine key={m.user_id} p={m} />)}
            </ul>
            <h2 className="mt-8 font-serif text-lg font-bold text-ink">店舗（{d.stores.length}）</h2>
            <ul className="mt-2 space-y-3">
              {d.stores.map((s) => (
                <li key={s.id} className="rounded-2xl border border-line bg-surface p-4">
                  <p className="break-words font-semibold text-ink">{s.name}</p>
                  <p className="mt-1 text-[12.5px]">店舗の所在地: <Where prefecture={s.prefecture} city={s.city} />
                    {s.address_source && <span className="ml-1 text-[11px] text-sub">（{s.address_source === "profile" ? "店舗プロフィールの値" : "店舗登録の値"}）</span>}</p>
                  <p className="text-[11.5px] text-sub">{s.visibility ? VIS_LABEL[s.visibility] : "公開設定なし"}／{USAGE_LABEL[s.usage_status] ?? s.usage_status}</p>
                  {s.members.length > 0 && <ul className="mt-2 space-y-2 border-t border-line pt-2">{s.members.map((m) => <PersonLine key={m.user_id} p={m} />)}</ul>}
                </li>
              ))}
            </ul>
            <p className="mt-8 rounded-xl bg-surface2 p-3 text-[11.5px] leading-relaxed text-sub">見学・採用案件、連絡履歴、請求履歴は、次の段階で追加します（現在はこの画面に出ません）。既存の採用・請求の確認は <Link href="/admin/companies" className="underline">会社（採用・請求）</Link> から。</p>
          </>
        );
      })()}
    </main>
  );
}
