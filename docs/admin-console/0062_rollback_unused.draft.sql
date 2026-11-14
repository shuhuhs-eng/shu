-- 0062 の【未使用時の完全削除】（草案）。請求・見積・決済の記録が1行も無いことを確認できた場合だけ使う。
-- 1行でもあれば、何も消さずに中止する（記録を失わないための安全装置）。運用開始後は 0062_suspend_keep_data.draft.sql（停止）を使う。
begin;
do $$
declare n bigint := 0; t text;
begin
  foreach t in array array['admin_quotes','admin_invoices','admin_invoice_lines','admin_invoice_checkouts','admin_invoice_webhook_events','admin_unresolved_billing_cases'] loop
    execute format('select count(*) from public.%I', t) into n;
    if n > 0 then raise exception '0062 のデータが残っています（% に % 行）。完全削除は中止しました。停止（0062_suspend_keep_data）を使ってください', t, n; end if;
  end loop;
end $$;
drop trigger if exists trg_admin_visit_case_fee_guard on public.admin_visit_cases;
drop function if exists public.admin_correct_hire_line(uuid, text), public.admin_recalculate_registration_line(uuid), public.admin_flag_billing_case(uuid, text, text), public._admin_assert_invoice_correctable(uuid),
  public.billing_begin_checkout(uuid), public.billing_list_invoices(uuid), public.company_respond_quote(uuid, boolean), public.company_list_quotes(uuid),
  public.admin_advance_invoice(uuid, text), public.admin_void_line(uuid), public.admin_add_registration_line(uuid), public.admin_add_fee_line(uuid, text, uuid),
  public.admin_create_invoice(uuid, uuid), public.admin_withdraw_quote(uuid), public.admin_propose_quote(uuid, integer, text);
drop table if exists public.admin_unresolved_billing_cases, public.admin_invoice_webhook_events, public.admin_invoice_checkouts, public.admin_invoice_lines,
  public.admin_invoices, public.admin_quotes cascade;
drop function if exists public._admin_visit_case_fee_guard(), public._admin_invoice_requires_amounts(), public._admin_invoice_line_rules(), public._admin_quotes_rules(),
  public._admin_invoice_payable_by(uuid, uuid), public._admin_org_billing_actor(uuid, uuid), public._admin_tax(integer), public.registration_fee_for_store_count(integer);
commit;
