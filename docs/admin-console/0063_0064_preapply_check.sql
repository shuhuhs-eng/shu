-- 0063・0064 適用前の確認（読み取り専用。何も変更しない）。0062 の適用と「0062 適用後チェック」の後、0063 の直前に実行する。
-- 出力は PASS / FAIL / INFO の表。FAIL が1つでもあれば最後にエラーで止まる。FAIL のまま適用しない。
begin;
create temp table pre_log (n serial, name text, result text, info text);
do $$
declare v text; f text; t text;
begin
  -- 前提: 0062 が適用済み（0064 は 0062 の請求行と接続する）
  foreach t in array array['admin_invoice_lines','admin_invoices','admin_invoice_checkouts','admin_unresolved_billing_cases','hiring_success_fees','hiring_success_fee_events','stripe_checkout_records','store_hiring_processes','organization_subscriptions','salon_organizations'] loop
    insert into pre_log(name, result, info) select '1 前提の表: ' || t, case when to_regclass('public.' || t) is not null then 'PASS' else 'FAIL' end, '';
  end loop;
  insert into pre_log(name, result, info) select '1 前提の列: admin_invoice_lines.hiring_process_id（0062 v4）', case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='admin_invoice_lines' and column_name='hiring_process_id') then 'PASS' else 'FAIL' end, '';
  foreach f in array array['is_platform_admin','get_admin_billing_integrity_issues','admin_flag_billing_case'] loop
    insert into pre_log(name, result, info) select '1 前提の関数: ' || f, case when exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname = f) then 'PASS' else 'FAIL' end, '';
  end loop;
  -- 0063/0064 の新設物が未作成
  foreach t in array array['organization_location_events','organization_billing_regime','hiring_process_billing_basis'] loop
    insert into pre_log(name, result, info) select '2 未作成の表: ' || t, case when to_regclass('public.' || t) is null then 'PASS' else 'FAIL' end, '';
  end loop;
  insert into pre_log(name, result, info) select '2 salon_organizations に hq_* 列が未作成', case when not exists (select 1 from information_schema.columns where table_schema='public' and table_name='salon_organizations' and column_name like 'hq\_%') then 'PASS' else 'FAIL' end, '';
  foreach f in array array['is_known_prefecture','admin_get_organization_location','admin_set_organization_location','_billing_append_only','_hiring_lock','_billing_regime_active','_hiring_process_basis','_hiring_has_active_hire_line','_trg_fee_insert_basis','_trg_fee_update_basis','_trg_checkout_basis','_trg_hire_line_regime_guard','admin_set_billing_regime','admin_set_process_billing_basis','admin_billing_regime_status'] loop
    insert into pre_log(name, result, info) select '3 未作成の関数: ' || f, case when not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname = f) then 'PASS' else 'FAIL' end, '';
  end loop;
  insert into pre_log(name, result, info) select '4 0064 のトリガーが未作成', case when not exists (select 1 from pg_trigger where tgname in ('trg_admin_invoice_lines_regime_guard','trg_stripe_checkout_basis','trg_hiring_success_fees_basis_update','trg_hiring_success_fees_basis_insert','trg_regime_append_only','trg_basis_append_only')) then 'PASS' else 'FAIL' end, '';
  -- 0064 は旧成功報酬・決済の既存データを変更しない。適用前の件数を記録（適用後に同じであること）
  insert into pre_log(name, result, info) select '5 旧成功報酬の件数・状態別（適用後と一致すること）', 'INFO', coalesce((select string_agg(fee_status || '=' || n, ',' order by fee_status) from (select fee_status, count(*) n from public.hiring_success_fees group by 1) s), '0件');
  insert into pre_log(name, result, info) select '5 stripe_checkout_records の件数（適用後と一致すること）', 'INFO', (select count(*)::text from public.stripe_checkout_records);
  insert into pre_log(name, result, info) select '5 0040 整合性チェックの定義の指紋（適用後は変わる＝0064が1行を足す）', 'INFO', md5(pg_get_functiondef('public.get_admin_billing_integrity_issues()'::regprocedure));
  insert into pre_log(name, result, info) select '6 platform_admins が1件以上', case when (select count(*) from public.platform_admins) >= 1 then 'PASS' else 'FAIL' end, (select count(*)::text from public.platform_admins);
end $$;
select n, name, result, info from pre_log order by n;
do $$ begin if exists (select 1 from pre_log where result = 'FAIL') then raise exception '適用前チェックに FAIL があります。適用しないでください。'; end if; end $$;
rollback;
