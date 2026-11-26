import Link from "next/link";
import { requireAdminOperator } from "@/lib/admin/operator-guard";
import { isPlatformAdmin } from "@/lib/admin/is-admin";
import { OpsEmpty, OpsError, PageHead } from "@/components/admin/operations-ui";
import { scoutLedgerEnabled } from "@/lib/billing/hire-flags";
import { loadCampaigns, loadSettings, loadSummary } from "@/lib/billing/ledger-loader";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const PAGE = 50;
const CONSUME_NOTES: Record<string, string> = {
  scout_consume_order: "消費の順序（無料分・購入分）は未決定です。決まるまで台帳からの消費はできません。",
  scout_refund_balance_policy: "返金時の残高の扱いは未決定です。決まるまで購入の取消反映はできません。",
  scout_campaign_stacking: "キャンペーンの併用規則は未決定です（同時に有効にできるのは1件だけです）。",
};

/** 運営（責任者のみ）: スカウト台帳の確認。★読み取り専用。既存の送信可能数の判定・購入処理はまだ切り替えていません。 */
export default async function ScoutLedgerPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { supabase } = await requireAdminOperator("/admin/scout-ledger");
  const page = Math.max(1, Number.parseInt(String(sp.page ?? "1"), 10) || 1);
  if (!scoutLedgerEnabled()) return <main className="mx-auto max-w-[900px] px-5 py-10"><PageHead title="スカウト台帳" lead="この機能はまだ有効になっていません（データベースの準備とレビューの完了後に有効にします）。" /></main>;
  if (!(await isPlatformAdmin(supabase))) return <main className="mx-auto max-w-[900px] px-5 py-10"><PageHead title="スカウト台帳" lead="この画面は責任者のみ確認できます。" /></main>;
  const [sum, camp, settings] = await Promise.all([loadSummary(supabase, page, PAGE), loadCampaigns(supabase), loadSettings(supabase)]);
  const open = settings.ok ? settings.data.filter((x) => x.status === "undecided" && CONSUME_NOTES[x.key]) : [];
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <PageHead title="スカウト台帳" lead={<>法人別の残高と履歴の確認です（読み取り専用）。<b>既存の送信可能数の判定・追加枠の購入処理は、まだこの台帳へ切り替えていません。</b>この残高は現在の送信可否には使われません。</>} />
      {!settings.ok && <p role="alert" className="mt-4 text-[12.5px] font-semibold text-[#8A2E2E]">設定の一覧を取得できませんでした（「未決定なし」ではありません）。</p>}
      {open.length > 0 && <ul className="mt-4 list-disc space-y-1 rounded-2xl border border-line bg-surface p-4 pl-8 text-[12.5px] text-sub" aria-label="未決定の事項">{open.map((x) => <li key={x.key}>{CONSUME_NOTES[x.key]}</li>)}</ul>}
      {!sum.ok ? <OpsError reason={sum.reason} /> : sum.data.rows.length === 0 ? <OpsEmpty>法人がありません。</OpsEmpty> : (
        <div className="mt-5 overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-left text-[12.5px]">
            <thead className="bg-surface2 text-[11.5px] text-sub"><tr><th className="p-3">法人</th><th className="p-3 text-right">残高</th><th className="p-3 text-right">無料分</th><th className="p-3 text-right">購入分</th><th className="p-3 text-right">付与</th><th className="p-3 text-right">購入</th><th className="p-3 text-right">消費</th><th className="p-3 text-right">取消</th></tr></thead>
            <tbody>{sum.data.rows.map((r) => (
              <tr key={r.organization_id} className="border-t border-line">
                <td className="p-3"><Link className="inline-flex min-h-[44px] items-center underline" href={`/admin/scout-ledger/${r.organization_id}`}>{r.organization_name}</Link></td>
                <td className="p-3 text-right font-semibold">{r.balance}</td><td className="p-3 text-right">{r.free_balance}</td><td className="p-3 text-right">{r.paid_balance}</td>
                <td className="p-3 text-right">{r.granted}</td><td className="p-3 text-right">{r.purchased}</td><td className="p-3 text-right">{r.consumed}</td><td className="p-3 text-right">{r.reversed}</td>
              </tr>))}</tbody>
          </table>
        </div>)}
      {sum.ok && sum.data.total > PAGE && (
        <nav className="mt-6 flex items-center justify-between text-[12.5px]" aria-label="ページ送り">
          {page > 1 ? <Link href={`/admin/scout-ledger?page=${page - 1}`} className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 font-semibold">前へ</Link> : <span />}
          <span className="text-sub">{sum.data.total}件中 {page} / {Math.ceil(sum.data.total / PAGE)} ページ</span>
          {page * PAGE < sum.data.total ? <Link href={`/admin/scout-ledger?page=${page + 1}`} className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 font-semibold">次へ</Link> : <span />}
        </nav>)}
      <section className="mt-8" aria-label="キャンペーン">
        <h2 className="text-[14px] font-semibold">キャンペーン（設定の確認）</h2>
        {!camp.ok ? <OpsError reason={camp.reason} /> : camp.data.length === 0 ? <p className="mt-2 text-[12.5px] text-sub">キャンペーンはありません。</p> : (
          <ul className="mt-2 space-y-2 text-[12.5px]">{camp.data.map((c) => <li key={c.id} className="rounded-xl border border-line bg-surface p-3"><b>{c.name}</b>（{c.status === "active" ? "有効" : c.status === "draft" ? "下書き" : "終了"}） {c.quantity}件・税抜{c.price_excl_tax.toLocaleString("ja-JP")}円 ／ {c.starts_on}〜{c.ends_on}</li>)}</ul>)}
      </section>
    </main>
  );
}
