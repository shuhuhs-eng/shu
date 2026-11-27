import Link from "next/link";
import { requireAdminOperator } from "@/lib/admin/operator-guard";
import { fmtJst, OpsEmpty, OpsError, PageHead } from "@/components/admin/operations-ui";
import { OpenAgreementButton } from "@/components/admin/hire-agreement-panel";
import { hireBillingEnabled } from "@/lib/billing/hire-flags";
import { isPlatformAdmin } from "@/lib/admin/is-admin";
import { getIntegrity, listAgreements, listSettingChanges, listSettings } from "@/lib/billing/hire-loader";
import { HireRoleRuleDecision } from "@/components/admin/billing-settings-panel";
import { AGREEMENT_STATUS_LABELS, BILLING_SETTING_LABELS, HIRE_ROLE_RULE_VALUE_LABEL, FEE_ROLE_LABELS, INTEGRITY_LABELS, SCHEDULE_STATUS_LABELS, yen } from "@/lib/billing/hire-agreement";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const PAGE = 50;
const settingValueLabel = (key: string, v: string | null) => (key === "hire_fee_role_source" ? HIRE_ROLE_RULE_VALUE_LABEL : v ?? "—");

/** 運営: 採用契約（入社意思確認・サロンの内定・請求予定）の一覧。★請求は実行されない（自動請求は無効）。機能フラグがオフの間は何も取得しない。 */
export default async function HireAgreementsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { supabase } = await requireAdminOperator("/admin/hire-agreements");
  const view = sp.view === "attention" ? "attention" : "all";
  const page = Math.max(1, Number.parseInt(String(sp.page ?? "1"), 10) || 1);
  if (!hireBillingEnabled()) {
    return <main className="mx-auto max-w-[900px] px-5 py-10"><PageHead title="採用契約・採用料" lead="この機能はまだ有効になっていません（データベースの準備とレビューの完了後に有効にします）。" /></main>;
  }
  const res = await listAgreements(supabase, view, page, PAGE);
  const responsible = await isPlatformAdmin(supabase);
  const settings = await listSettings(supabase);
  const changes = responsible ? await listSettingChanges(supabase, 20) : null;   // 変更履歴は責任者のみ
  const roleRule = settings.ok ? settings.data.find((x) => x.key === "hire_fee_role_source") : null;
  const integrity = responsible ? await getIntegrity(supabase) : null;   // 新旧の整合の確認（責任者のみ）
  const tab = (v: string, label: string) => <Link href={v === "all" ? "/admin/hire-agreements" : `/admin/hire-agreements?view=${v}`} className={`inline-flex min-h-[44px] items-center rounded-full px-4 text-[12.5px] font-semibold ${view === v ? "bg-ink text-white" : "border border-line"}`}>{label}</Link>;
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <PageHead title="採用契約・採用料" lead={<>本人の入社意思確認（運営）→ サロンの内定操作 → 請求予定（最初に登録した入社予定日の翌日・後から変えても動かない）。<b>この画面では請求は実行されません。自動請求は無効です。</b></>} />
      {integrity && (!integrity.ok ? <p role="alert" className="mt-4 rounded-xl bg-[#C24545]/10 px-3 py-2 text-[12.5px] font-semibold text-[#8A2E2E]">新旧の整合の確認を取得できませんでした（「問題なし」ではありません）。読み込み直してください。</p>
        : integrity.data.length > 0 && (<section aria-label="新旧の整合の確認" className="mt-4 rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
          <h2 className="text-[14px] font-semibold">新旧の整合の確認（責任者のみ）</h2>
          <ul className="mt-2 space-y-2">{integrity.data.map((x, i) => (<li key={`${x.kind}-${x.agreement_id}-${i}`} className={x.severity === "error" ? "font-semibold text-[#8A2E2E]" : "text-sub"}>
            <span>{x.severity === "error" ? "要対応: " : "情報: "}{INTEGRITY_LABELS[x.kind] ?? x.kind}</span>
            <Link href={`/admin/hire-agreements/${x.agreement_id}`} className="ml-2 inline-flex min-h-[44px] items-center underline">契約を開く</Link></li>))}</ul></section>))}
      <section aria-label="課金設定" className="mt-4 rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
        <h2 className="text-[14px] font-semibold">課金設定（変更できるのは責任者のみ）</h2>
        {!settings.ok ? <p role="alert" className="mt-2 font-semibold text-[#8A2E2E]">設定の一覧を取得できませんでした（「問題なし」ではありません）。</p> : (
          <ul className="mt-2 space-y-1 text-sub">{settings.data.filter((x) => BILLING_SETTING_LABELS[x.key] || x.status === "undecided").map((x) => (
            <li key={x.key}><span className="text-charcoal">{BILLING_SETTING_LABELS[x.key] ?? x.key}</span>: {x.key === "hire_fee_role_source" && x.status === "decided" ? HIRE_ROLE_RULE_VALUE_LABEL : x.status === "undecided" ? <b className="text-[#8A2E2E]">未決定</b> : x.key === "auto_charge_enabled" || x.key === "salon_card_required" ? (x.value === "true" ? "ON" : "OFF") : x.value}</li>))}</ul>)}
        <p className="mt-2 text-[12px] text-sub">自動請求とカード必須化は、この画面からは変更できません（現在の値の表示のみ）。</p>
        {roleRule?.status === "undecided" && (!responsible ? <p className="mt-2 text-[12px] text-sub">採用料の登録区分ルールの決定は、責任者のみ記録できます。</p>
          : changes?.ok ? <HireRoleRuleDecision />
          : <p role="alert" className="mt-2 text-[12px] font-semibold text-[#8A2E2E]">変更履歴の機能（DB 0112）が使えない状態のため、決定は記録できません（履歴が残らない変更は行いません）。</p>)}
        {responsible && (changes && !changes.ok ? <p className="mt-2 text-[12px] text-sub">変更履歴は、DB 0112 の適用後に表示されます（取得できませんでした）。</p> : changes?.ok && (
          <div className="mt-3"><h3 className="text-[12.5px] font-semibold">変更履歴（新しい順）</h3>
            {changes.data.length === 0 ? <p className="mt-1 text-[12px] text-sub">履歴はまだありません。</p> : <ul className="mt-1 space-y-1 text-[12px] text-sub">{changes.data.map((c) => (
              <li key={c.id}>{fmtJst(c.changed_at)} ／ {BILLING_SETTING_LABELS[c.setting_key] ?? c.setting_key}: {c.old_status === "undecided" ? "未決定" : settingValueLabel(c.setting_key, c.old_value)} → {c.new_status === "undecided" ? "未決定" : settingValueLabel(c.setting_key, c.new_value)}{c.note ? `（${c.note}）` : ""}</li>))}</ul>}
          </div>))}
      </section>
      <div className="mt-4 flex flex-wrap gap-2">{tab("all", "すべて")}{tab("attention", "要確認（代理操作可・再確認待ち・返金確認）")}</div>
      {!res.ok ? <OpsError reason={res.reason} /> : res.data.rows.length === 0 ? <OpsEmpty>該当する採用契約はありません。</OpsEmpty> : (
        <ul className="mt-5 space-y-3">
          {res.data.rows.map((r) => (
            <li key={r.agreement_id ?? r.hiring_process_id} className="rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{r.organization_name} ／ {r.store_name}</p>
                <span className="rounded-full bg-surface2 px-3 py-1 text-[11.5px] font-semibold">{AGREEMENT_STATUS_LABELS[r.status] ?? r.status}</span>
              </div>
              <p className="mt-1 text-sub">
                登録区分: {r.fee_role ? FEE_ROLE_LABELS[r.fee_role] : "未入力"} ／ 入社予定日: {r.start_date ?? "未入力"} ／ 更新: {fmtJst(r.updated_at)}
                {r.schedule_status && <> ／ 請求予定: {SCHEDULE_STATUS_LABELS[r.schedule_status]}（{r.charge_on}・{r.total_amount != null ? yen(r.total_amount) : "—"}）</>}
              </p>
              {r.needs_refund_review && <p role="alert" className="mt-1 font-semibold text-[#8A2E2E]">要確認: 請求が始まった後に辞退・取消、または登録区分の変更がありました。返金・請求の扱いを運営が確認してください（自動返金はしません）。</p>}
              {r.needs_reconfirm && <p role="alert" className="mt-1 font-semibold text-[#8A2E2E]">再確認待ち: 確認済みの条件が変更されました。再確認が済むまで請求へは進みません。</p>}
              {r.proxy_available && <p className="mt-1 font-semibold text-[#8A2E2E]">サロンが7日間未操作です。責任者は代理で内定を確定できます。</p>}
              <div className="mt-3">
                {r.agreement_id ? <Link href={`/admin/hire-agreements/${r.agreement_id}`} className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 font-semibold">詳細・操作</Link>
                  : <OpenAgreementButton hiringProcessId={r.hiring_process_id} />}
              </div>
            </li>
          ))}
        </ul>)}
      {res.ok && res.data.total > PAGE && (
        <nav className="mt-6 flex items-center justify-between text-[12.5px]" aria-label="ページ送り">
          {page > 1 ? <Link href={`/admin/hire-agreements?view=${view}&page=${page - 1}`} className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 font-semibold">前へ</Link> : <span />}
          <span className="text-sub">{res.data.total}件中 {page} / {Math.ceil(res.data.total / PAGE)} ページ</span>
          {page * PAGE < res.data.total ? <Link href={`/admin/hire-agreements?view=${view}&page=${page + 1}`} className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 font-semibold">次へ</Link> : <span />}
        </nav>)}
    </main>
  );
}
