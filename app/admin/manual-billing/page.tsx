import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/guard";
import { manualBillingEnabled } from "@/lib/billing/hire-flags";
import { fmtJst } from "@/components/admin/operations-ui";
import { CandidateRow } from "@/components/admin/manual-billing-forms";
import { FILTER_LABELS, STATUS_LEGEND, isFilter, KIND_LABELS, statusLabel, yen, type Candidate, type InvoiceList } from "@/lib/billing/manual-billing";

type Rpc = { rpc: (n: string, a: object) => Promise<{ data: unknown; error: unknown }> };
const PAGE = 50;

/** 運営（責任者のみ）: 見学・体験料／採用料の手動請求（請求書の発行記録）と入金管理。MANUAL_BILLING_ENABLED=1 のときだけ使える（既定オフ）。オンライン決済はしない。 */
export default async function ManualBillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams; const { supabase } = await requireAdminPage("/admin/manual-billing");
  const head = <h1 className="font-serif text-2xl font-bold text-ink">手動請求・入金管理</h1>;
  if (!manualBillingEnabled()) return <main className="mx-auto max-w-[900px] px-5 py-10">{head}<p className="mt-3 text-[12.5px] text-sub">この機能はまだ有効になっていません。</p></main>;
  const f = typeof sp.status === "string" && isFilter(sp.status) ? sp.status : null;
  const page = Math.max(1, Number.parseInt(String(sp.page ?? "1"), 10) || 1);
  const r = supabase as unknown as Rpc;
  const [list, cand] = await Promise.all([r.rpc("admin_manual_invoices_list", { p_status: f, p_limit: PAGE, p_offset: (page - 1) * PAGE }), r.rpc("admin_manual_billing_candidates", {})]);
  const L = !list.error && list.data && typeof list.data === "object" ? (list.data as InvoiceList) : null;
  const C = !cand.error && Array.isArray(cand.data) ? (cand.data as Candidate[]) : null;
  const chip = (on: boolean) => `inline-flex min-h-[44px] items-center rounded-full border px-4 text-[12.5px] font-semibold ${on ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink"}`;
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      {head}
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">請求書の発行と入金の確認を記録します。カードやオンライン決済は使いません。採用料の自動請求はOFFのままです（請求書を発行した採用料は、自動請求の対象から外れます）。</p>
      {L && <p className="mt-4 text-[13px]">未入金の合計 <b>{yen(L.open_outstanding)}</b>　うち期限超過 <b className="text-[#8A2E2E]">{yen(L.overdue_outstanding)}</b></p>}
      <p className="mt-3 text-[11.5px] text-sub">{STATUS_LEGEND}</p>
      <nav className="mt-3 flex flex-wrap gap-2" aria-label="絞り込み"><Link className={chip(!f)} href="/admin/manual-billing">すべて</Link>{(Object.keys(FILTER_LABELS) as (keyof typeof FILTER_LABELS)[]).map((k) => <Link key={k} className={chip(f === k)} href={`/admin/manual-billing?status=${k}`}>{FILTER_LABELS[k]}</Link>)}</nav>
      {!L ? <p role="alert" className="mt-4 text-[12.5px] text-[#8A2E2E]">請求の一覧を取得できませんでした。</p> : L.rows.length === 0 ? <p className="mt-4 text-[12.5px] text-sub">該当する請求はありません。</p> : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-surface"><table className="w-full min-w-[720px] text-left text-[12.5px]">
          <thead className="bg-surface2 text-[11.5px] text-sub"><tr><th className="p-3">請求番号</th><th className="p-3">会社</th><th className="p-3">種別</th><th className="p-3 text-right">請求額（税込）</th><th className="p-3 text-right">残額</th><th className="p-3">支払期限</th><th className="p-3">状態</th></tr></thead>
          <tbody>{L.rows.map((x) => <tr key={x.id} className="border-t border-line"><td className="p-3"><Link className="inline-flex min-h-[44px] items-center underline" href={`/admin/manual-billing/${x.id}`}>{x.invoice_no}</Link></td><td className="p-3">{x.organization_name}</td><td className="p-3">{KIND_LABELS[x.kind]}</td><td className="p-3 text-right">{yen(x.total_amount)}</td><td className="p-3 text-right font-semibold">{yen(x.outstanding)}</td><td className="p-3 whitespace-nowrap">{x.due_on}</td><td className={`p-3 ${x.overdue ? "font-semibold text-[#8A2E2E]" : ""}`}>{statusLabel(x)}</td></tr>)}</tbody></table></div>)}
      {L && L.total > PAGE && <nav className="mt-4 flex justify-between text-[12.5px]" aria-label="ページ送り">{page > 1 ? <Link className="inline-flex min-h-[44px] items-center underline" href={`/admin/manual-billing?${f ? `status=${f}&` : ""}page=${page - 1}`}>前へ</Link> : <span />}<span className="text-sub">{L.total}件中 {page} / {Math.ceil(L.total / PAGE)}</span>{page * PAGE < L.total ? <Link className="inline-flex min-h-[44px] items-center underline" href={`/admin/manual-billing?${f ? `status=${f}&` : ""}page=${page + 1}`}>次へ</Link> : <span />}</nav>}
      <section className="mt-10" aria-label="請求書を発行できるもの">
        <h2 className="font-serif text-lg font-bold text-ink">請求書を発行できるもの</h2>
        <p className="mt-1 text-[12px] text-sub">支払い前の見学・体験料と、確定済みの採用料の請求予定です。金額は元の記録（税込）のとおりで、ここでは変更できません。</p>
        {!C ? <p role="alert" className="mt-3 text-[12.5px] text-[#8A2E2E]">候補を取得できませんでした。</p> : C.length === 0 ? <p className="mt-3 text-[12.5px] text-sub">請求書を発行できるものはありません。</p> : <ul className="mt-3 space-y-2">{C.map((c) => <CandidateRow key={`${c.kind}:${c.source_id}`} c={c} />)}</ul>}
      </section>
      <p className="mt-8 text-[11px] text-sub">最終更新の表示: {fmtJst(new Date().toISOString())}</p>
    </main>
  );
}
