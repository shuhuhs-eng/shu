import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminOperator } from "@/lib/admin/operator-guard";
import { getVisitRequest, listVisitRequests } from "@/lib/admin/visit-requests";
import { CLOSED_REASON_LABELS, CONFIRM_LABELS, ENTRANCE_LABELS, KIND_LABELS, SOURCE_CANCELLED_TEXT, STATUS_LABELS } from "@/lib/admin/visit-requests-shared";
import { fmtJst, linkCls, OpsError, PageHead } from "@/components/admin/operations-ui";
import { VisitRequestPanel } from "@/components/admin/visit-request-panel";
import { WorkLogList } from "@/components/admin/work-log-list";
import { VisitFeePanel, type FeeView } from "@/components/admin/visit-fee-panel";
import { visitFeeEnabled } from "@/lib/billing/visit-fee-flag";
import { isPlatformAdmin } from "@/lib/admin/is-admin";
import { loadOperators, loadWorkRecords } from "@/lib/admin/work-log-loader";
import { assigneeOptions, buildWorkLog, nameOf } from "@/lib/admin/work-log";

type Props = { params: Promise<{ id: string }> };

/** 運営: 見学・体験入店の受付の詳細・更新。内部メモ・確認記録・履歴は運営のみ。相手（美容師・店舗）へは表示しない。 */
export default async function AdminVisitRequestDetail({ params }: Props) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, user } = await requireAdminOperator(`/admin/visit-requests/${id}`);
  const res = await getVisitRequest(supabase, id);
  if (!res.ok) return <main className="mx-auto max-w-[900px] px-5 py-10"><OpsError reason={res.reason} /></main>;
  const d = res.data;
  // 重複として統合できる候補（同じ美容師・店舗・種別の別の未終了の受付）
  const [opsRes, recRes] = await Promise.all([loadOperators(supabase), loadWorkRecords(supabase, "visit_request", id)]);
  const ops = opsRes.ok ? opsRes.data : [];
  const log = recRes.ok ? buildWorkLog(recRes.data, ops) : [];
  const all = await listVisitRequests(supabase, { entrance: "", kind: d.kind, status: "", legacy: false, page: 1 });
  const mergeCandidates = all.ok
    ? all.data.rows.filter((r) => r.request_id && r.request_id !== d.id && r.stylist_user_id === d.stylist_user_id && r.store_id === d.store_id && r.status !== "closed")
        .map((r) => ({ id: r.request_id as string, label: `${ENTRANCE_LABELS[r.entrance]} / ${STATUS_LABELS[r.status]}${r.scheduled_on ? ` / ${r.scheduled_on}` : ""}` }))
    : [];
  // 料金（責任者のみ・機能フラグ有効時のみ。0108適用前は呼ばない）。取得に失敗したら「0件」ではなく取得失敗を表示する。
  let fee: FeeView | null = null; let feeError = false;
  if (visitFeeEnabled() && d.occurrence_id && d.status === "attended" && (await isPlatformAdmin(supabase))) {
    const r = await (supabase as unknown as { rpc: (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }).rpc("admin_visit_fee_get", { p_occurrence_id: d.occurrence_id });
    if (r.error) feeError = true; else fee = (r.data as FeeView | null) ?? null;
  }
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <Link href="/admin/visit-requests" className="text-[12px] text-sub underline">受付一覧へ</Link>
      <PageHead title={`${KIND_LABELS[d.kind] ?? d.kind}の受付`} lead={<>入口: {ENTRANCE_LABELS[d.source_kind] ?? d.source_kind}。状態: <b>{STATUS_LABELS[d.status] ?? d.status}</b>。受付や状態の変更で請求・決済は作られません。</>} />
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-2xl border border-line bg-surface p-4 text-[12.5px] text-sub">
        {d.source_cancelled && (<><dt>入口の希望</dt><dd className="font-semibold text-[#8A2E2E]">{SOURCE_CANCELLED_TEXT}</dd></>)}
        <dt>現在の担当</dt><dd className="text-charcoal">{!opsRes.ok ? "取得できませんでした" : d.assigned_admin_id ? nameOf(d.assigned_admin_id, ops) : "未割当"}</dd>
        <dt>実施日</dt><dd className="text-charcoal">{d.scheduled_on ?? "未定"}</dd>
        {d.closed_reason && (<><dt>終了の理由</dt><dd className="text-charcoal">{CLOSED_REASON_LABELS[d.closed_reason] ?? d.closed_reason}{d.merged_into_request_id && <> （<Link className="underline" href={`/admin/visit-requests/${d.merged_into_request_id}`}>統合先</Link>）</>}</dd></>)}
        <dt>実施後の確認</dt>
        <dd className="text-charcoal">{d.confirmations.length === 0 ? "未記録" : d.confirmations.map((c) => `${c.party === "salon" ? "サロン" : "本人"}: ${CONFIRM_LABELS[c.result] ?? c.result}（${fmtJst(c.confirmed_at)}）`).join(" / ")}</dd>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={`/admin/stylists/${d.stylist_user_id}`} className={linkCls}>美容師の詳細</Link>
      </div>
      <VisitRequestPanel key={d.updated_at} d={d} mergeCandidates={mergeCandidates} meId={user.id} assignees={opsRes.ok ? assigneeOptions(ops, d.assigned_admin_id) : null} />
      {fee && <VisitFeePanel fee={fee} />}
      {feeError && <p role="alert" className="mt-4 text-[12.5px] font-semibold text-[#8A2E2E]">料金情報を取得できませんでした。読み込み直してください（「料金なし」ではありません）。</p>}
      <WorkLogList log={log} loaded={recRes.ok} />
    </main>
  );
}
