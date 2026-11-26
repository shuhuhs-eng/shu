import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminOperator } from "@/lib/admin/operator-guard";
import { isPlatformAdmin } from "@/lib/admin/is-admin";
import { fmtJst, OpsError, PageHead } from "@/components/admin/operations-ui";
import { scoutLedgerEnabled } from "@/lib/billing/hire-flags";
import { loadEntries } from "@/lib/billing/ledger-loader";
import { ENTRY_LABELS, POOL_LABELS } from "@/lib/billing/ledger";

type Props = { params: Promise<{ orgId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const PAGE = 50;

/** 運営（責任者のみ）: 法人のスカウト台帳（残高・無料分・購入分・付与/購入/消費/取消の履歴）。読み取り専用。 */
export default async function ScoutLedgerOrg({ params, searchParams }: Props) {
  const { orgId } = await params; const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) notFound();
  const { supabase } = await requireAdminOperator(`/admin/scout-ledger/${orgId}`);
  const page = Math.max(1, Number.parseInt(String(sp.page ?? "1"), 10) || 1);
  if (!scoutLedgerEnabled()) return <main className="mx-auto max-w-[900px] px-5 py-10"><PageHead title="スカウト台帳" lead="この機能はまだ有効になっていません。" /></main>;
  if (!(await isPlatformAdmin(supabase))) return <main className="mx-auto max-w-[900px] px-5 py-10"><PageHead title="スカウト台帳" lead="この画面は責任者のみ確認できます。" /></main>;
  const res = await loadEntries(supabase, orgId, page, PAGE);
  if (!res.ok) return <main className="mx-auto max-w-[900px] px-5 py-10"><OpsError reason={res.reason} /></main>;
  const d = res.data; if (!d) notFound();
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <Link href="/admin/scout-ledger" className="inline-flex min-h-[44px] items-center text-[12px] text-sub underline">台帳一覧へ</Link>
      <PageHead title={d.organization_name} lead={<>残高 <b>{d.balance}</b>件（無料分 {d.free_balance}件・購入分 {d.paid_balance}件）。読み取り専用で、既存の送信可能数の判定には使われていません。</>} />
      {d.rows.length === 0 ? <p className="mt-6 text-[12.5px] text-sub">履歴はまだありません（初回付与は行われていません）。</p> : (
        <div className="mt-5 overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[620px] text-left text-[12.5px]">
            <thead className="bg-surface2 text-[11.5px] text-sub"><tr><th className="p-3">日時</th><th className="p-3">種別</th><th className="p-3 text-right">件数</th><th className="p-3">分類</th><th className="p-3">店舗</th><th className="p-3">参照</th></tr></thead>
            <tbody>{d.rows.map((e) => (
              <tr key={e.id} className="border-t border-line align-top">
                <td className="p-3 whitespace-nowrap">{fmtJst(e.created_at)}</td><td className="p-3">{ENTRY_LABELS[e.entry_type] ?? e.entry_type}</td>
                <td className={`p-3 text-right font-semibold ${e.quantity < 0 ? "text-[#8A2E2E]" : ""}`}>{e.quantity > 0 ? `+${e.quantity}` : e.quantity}</td>
                <td className="p-3">{POOL_LABELS[e.pool] ?? e.pool}</td><td className="p-3">{e.store_name ?? "—"}</td><td className="p-3 break-all text-sub">{e.source_ref}{e.note ? `（${e.note}）` : ""}</td>
              </tr>))}</tbody>
          </table>
        </div>)}
      {d.total > PAGE && (
        <nav className="mt-6 flex items-center justify-between text-[12.5px]" aria-label="ページ送り">
          {page > 1 ? <Link href={`/admin/scout-ledger/${orgId}?page=${page - 1}`} className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 font-semibold">前へ</Link> : <span />}
          <span className="text-sub">{d.total}件中 {page} / {Math.ceil(d.total / PAGE)} ページ</span>
          {page * PAGE < d.total ? <Link href={`/admin/scout-ledger/${orgId}?page=${page + 1}`} className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 font-semibold">次へ</Link> : <span />}
        </nav>)}
    </main>
  );
}
