import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminOperator } from "@/lib/admin/operator-guard";
import { isPlatformAdmin } from "@/lib/admin/is-admin";
import { fmtJst, OpsError, PageHead } from "@/components/admin/operations-ui";
import { HireAgreementPanel } from "@/components/admin/hire-agreement-panel";
import { hireBillingEnabled } from "@/lib/billing/hire-flags";
import { getAgreement, listSettings } from "@/lib/billing/hire-loader";
import { AGREEMENT_STATUS_LABELS, FEE_ROLE_LABELS, SCHEDULE_STATUS_LABELS, UNDECIDED_NOTES, yen } from "@/lib/billing/hire-agreement";

type Props = { params: Promise<{ id: string }> };

/** 運営: 採用契約の詳細・操作。★請求は実行されない。役職の判定元・自動請求の再試行方針などは未決定のため、画面に明示する。 */
export default async function HireAgreementDetail({ params }: Props) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await requireAdminOperator(`/admin/hire-agreements/${id}`);
  if (!hireBillingEnabled()) return <main className="mx-auto max-w-[900px] px-5 py-10"><PageHead title="採用契約" lead="この機能はまだ有効になっていません。" /></main>;
  const [res, settings, responsible] = await Promise.all([getAgreement(supabase, id), listSettings(supabase), isPlatformAdmin(supabase)]);
  if (!res.ok) return <main className="mx-auto max-w-[900px] px-5 py-10"><OpsError reason={res.reason} /></main>;
  const d = res.data; if (!d.agreement) notFound();
  const a = d.agreement; const s = d.schedule;
  const undecided = settings.ok ? settings.data.filter((x) => x.status === "undecided" && UNDECIDED_NOTES[x.key]) : [];
  const autoOn = settings.ok ? settings.data.find((x) => x.key === "auto_charge_enabled")?.value === "true" : null;
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <Link href="/admin/hire-agreements" className="inline-flex min-h-[44px] items-center text-[12px] text-sub underline">契約一覧へ</Link>
      <PageHead title={`${d.organization_name} ／ ${d.store_name}`} lead={<>状態: <b>{AGREEMENT_STATUS_LABELS[a.status] ?? a.status}</b>。この画面の操作で請求は実行されません。</>} />
      {a.needs_refund_review && <p role="alert" className="mt-4 rounded-xl bg-[#C24545]/10 px-3 py-2 text-[12.5px] font-semibold text-[#8A2E2E]">要確認: 請求が始まった後に辞退・取消、または役職の変更がありました。入社したか確認し、入社していなければ確認後に返金します（自動返金はしません）。返金・請求の扱いを運営が確認してください（自動返金はしません）。</p>}
      {a.needs_reconfirm && <p role="alert" className="mt-4 rounded-xl bg-[#C24545]/10 px-3 py-2 text-[12.5px] font-semibold text-[#8A2E2E]">再確認待ち: 確認済みの条件が変更されました（{a.terms_changed_at ? fmtJst(a.terms_changed_at) : "—"}）。サロンまたは（変更から{d.proxy_wait_days}日後に）責任者の代理による再確認が済むまで、請求予定は確認済みの条件のままで、自動請求へ進みません。</p>}
      {d.fee_conflict && <p role="alert" className="mt-4 rounded-xl bg-[#C24545]/10 px-3 py-2 text-[12.5px] font-semibold text-[#8A2E2E]">要確認: この採用には、すでに{d.fee_conflict === "legacy_fee" ? "金額のある旧成功報酬" : "新方式の請求明細"}があります。二重請求を防ぐため、請求予定は作られず、自動請求は開始されません。</p>}
      {(d.process_status === "declined" || d.process_status === "rejected") && a.status !== "declined" && a.status !== "cancelled" && <p role="alert" className="mt-4 rounded-xl bg-[#C24545]/10 px-3 py-2 text-[12.5px] font-semibold text-[#8A2E2E]">要確認: 採用の状況が{d.process_status === "declined" ? "辞退" : "不採用"}です。契約を辞退・取消にしてください（このままでは自動請求は開始されません）。</p>}
      <div className="mt-4 rounded-2xl border border-line bg-surface p-4 text-[12.5px]" aria-label="未決定の事項">
        <p className="font-semibold">自動請求: {autoOn === null ? "設定を取得できませんでした" : autoOn ? "有効" : "無効（請求は実行されません）"}</p>
        {!settings.ok && <p role="alert" className="mt-1 font-semibold text-[#8A2E2E]">設定の一覧を取得できませんでした（「未決定なし」ではありません）。</p>}
        {undecided.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-sub">{undecided.map((x) => <li key={x.key}>{UNDECIDED_NOTES[x.key]}</li>)}</ul>}
      </div>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-2xl border border-line bg-surface p-4 text-[12.5px] text-sub">
        <dt>美容師</dt><dd className="text-charcoal"><Link className="inline-flex min-h-[44px] items-center underline" href={`/admin/stylists/${a.stylist_user_id}`}>詳細</Link></dd>
        <dt>① 本人の入社意思確認</dt><dd className="text-charcoal">{a.stylist_intent_confirmed_at ? `確認済み（${fmtJst(a.stylist_intent_confirmed_at)}）` : "未確認"}</dd>
        <dt>入社予定日</dt><dd className="text-charcoal">{a.start_date ?? "未入力"}</dd>
        <dt>役職（採用料の区分）</dt><dd className="text-charcoal">{a.fee_role ? FEE_ROLE_LABELS[a.fee_role] : "未入力"}</dd>
        {a.confirmed_total != null && (<><dt>確認済みの条件</dt><dd className="text-charcoal">入社予定日 {a.confirmed_start_date} ／ {a.confirmed_fee_role ? FEE_ROLE_LABELS[a.confirmed_fee_role] : "—"} ／ 税抜 {yen(a.confirmed_fee_excl_tax ?? 0)} ＋ 税 {yen(a.confirmed_tax ?? 0)} ＝ {yen(a.confirmed_total)}（この金額が請求予定になります）</dd></>)}
        {a.confirmed_total != null && d.current_terms && d.current_terms.total !== a.confirmed_total && !a.needs_reconfirm && (<><dt>設定の変更</dt><dd className="text-charcoal">{`いまの料金設定では ${yen(d.current_terms.total)}です。確認済みの ${yen(a.confirmed_total)}は変わりません（請求予定は確認済みの金額のまま）。`}</dd></>)}
        <dt>② サロンの内定操作</dt><dd className="text-charcoal">{a.salon_confirmed_at ? `${a.salon_confirmed_via === "proxy" ? "責任者が代理で確定" : "サロンが確定"}（${fmtJst(a.salon_confirmed_at)}）${a.proxy_reason ? ` 理由: ${a.proxy_reason}` : ""}` : "未操作"}</dd>
        {a.close_reason && (<><dt>辞退・取消の理由</dt><dd className="text-charcoal">{a.close_reason}</dd></>)}
      </dl>
      <section className="mt-4 rounded-2xl border border-line bg-surface p-4 text-[12.5px]" aria-label="請求予定">
        <h2 className="text-[14px] font-semibold">③ 請求予定</h2>
        {s ? <p className="mt-2 text-sub">状態: <b className="text-charcoal">{SCHEDULE_STATUS_LABELS[s.status]}</b> ／ 請求予定日: {s.charge_on}（最初に登録した入社予定日の翌日。後から入社予定日を変えても変わりません） ／ 税抜 {yen(s.fee_amount)} ＋ 税 {yen(s.tax_amount)} ＝ <b className="text-charcoal">{yen(s.total_amount)}</b>{s.status === "retry_wait" && s.next_attempt_on ? <span className="block mt-1 text-charcoal">再試行日: {s.next_attempt_on}（失敗した日の3日後。追加2回まで・合計3回）</span> : null}{s.status === "invoice_switch" ? <span role="alert" className="block mt-1 font-semibold text-[#8A2E2E]">自動請求が3回とも失敗しました。請求書払いへの切替をサロンへ案内してください（自動では請求しません）。</span> : null}</p>
          : <p className="mt-2 text-sub">請求予定はまだありません（本人の入社意思確認とサロンの内定の両方が揃うと作られます）。</p>}
      </section>
      {a.status !== "declined" && a.status !== "cancelled" ? <HireAgreementPanel key={a.revision} d={d} isResponsible={responsible} /> : <>
        <p className="mt-4 text-[12.5px] text-sub">この契約は{a.status === "declined" ? "辞退" : "取消"}済みです。</p>
        {/* D4: 請求前の辞退・取消では請求予定は自動で取り消される。旧方式への切替は責任者の別操作（請求予定が無い／取消済みの契約だけ） */}
        {responsible && !a.legacy_route_released_at && (!d.schedule || d.schedule.status === "cancelled") && <HireAgreementPanel key={a.revision} d={d} isResponsible={responsible} />}
      </>}
    </main>
  );
}
