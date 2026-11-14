-- 0065 適用前の確認（読み取り専用。何も変更しない）。0062〜0064 の適用後、0065 の直前に実行する。
-- 一時テーブルは pg_temp 内だけ。出力は PASS / FAIL / INFO の【1つの表だけ】（最後の行が総合判定）。FAIL のまま適用しない。
drop table if exists pg_temp.pre_log;
create temp table pg_temp.pre_log (n serial, name text, result text, info text);
do $$
declare t text; f text;
begin
  foreach t in array array['admin_quotes','admin_invoices','admin_invoice_lines','admin_invoice_checkouts','admin_unresolved_billing_cases','admin_visit_cases','admin_audit_events','hiring_success_fees','organization_billing_regime','hiring_process_billing_basis','store_hiring_processes','salon_organizations','salon_stores'] loop
    insert into pg_temp.pre_log(name, result, info) select '1 前提の表（0062〜0064）: ' || t, case when to_regclass('public.' || t) is not null then 'PASS' else 'FAIL' end, '';
  end loop;
  foreach f in array array['is_platform_admin','_admin_org_billing_actor','_admin_tax','registration_fee_for_store_count','_billing_regime_active','_hiring_process_basis','admin_flag_billing_case','billing_begin_checkout'] loop
    insert into pg_temp.pre_log(name, result, info) select '2 前提の関数: ' || f, case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f) then 'PASS' else 'FAIL' end, '';
  end loop;
  foreach f in array array['admin_billing_summary','admin_list_quotes','admin_list_invoices','admin_get_invoice','admin_list_billable_cases','admin_list_unresolved_billing_cases','company_billing_overview','company_get_invoice'] loop
    insert into pg_temp.pre_log(name, result, info) select '3 0065の関数が未作成: ' || f, case when not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f) then 'PASS' else 'FAIL' end, '';
  end loop;
  insert into pg_temp.pre_log(name, result, info) select '4 platform_admins が1件以上', case when (select count(*) from public.platform_admins) >= 1 then 'PASS' else 'FAIL' end, (select count(*)::text from public.platform_admins);
  -- 0065 は読み取り専用。適用後に、下記の件数・指紋が一致すること（INFO）
  insert into pg_temp.pre_log(name, result, info) select '5 件数（適用後と一致すること）: ' || x.t, 'INFO', x.c::text
    from (select 'admin_quotes' t, (select count(*) from public.admin_quotes) c union all select 'admin_invoices', (select count(*) from public.admin_invoices)
          union all select 'admin_invoice_lines', (select count(*) from public.admin_invoice_lines) union all select 'admin_invoice_checkouts', (select count(*) from public.admin_invoice_checkouts)
          union all select 'admin_unresolved_billing_cases', (select count(*) from public.admin_unresolved_billing_cases) union all select 'admin_visit_cases', (select count(*) from public.admin_visit_cases)
          union all select 'hiring_success_fees', (select count(*) from public.hiring_success_fees) union all select 'organization_billing_regime', (select count(*) from public.organization_billing_regime)) x;
  insert into pg_temp.pre_log(name, result, info) select '5 public の表の数（適用後と一致すること＝0065は表を作らない）', 'INFO', (select count(*)::text from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','p'));
end $$;
-- 結果は【この1つの表だけ】。BEGIN/ROLLBACK を使わない（結果表を最後の1つにするため）。
select n, name, result, info from (
  select n, name, result, info from pg_temp.pre_log
  union all
  select 9999, '【総合判定】' || (select count(*) from pg_temp.pre_log where result = 'PASS') || ' PASS / ' || (select count(*) from pg_temp.pre_log where result = 'FAIL') || ' FAIL / ' || (select count(*) from pg_temp.pre_log where result = 'INFO') || ' INFO',
         case when exists (select 1 from pg_temp.pre_log where result = 'FAIL') then 'FAIL' else 'PASS' end, 'FAIL が0件なら適用してよい。1件でもあれば適用しない'
) r order by n;
