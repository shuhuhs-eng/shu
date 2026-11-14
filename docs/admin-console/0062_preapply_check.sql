-- 0062 適用前の確認（読み取り専用。何も変更しない）。0061 の適用後に、0062 の直前に実行する。
-- 出力は PASS / FAIL / INFO の表。FAIL が1つでもあれば最後にエラーで止まる。FAIL のまま適用しない。
begin;
create temp table pre_log (n serial, name text, result text, info text);
do $$
declare
  v text; rc record;
  new_tables text[] := array['admin_quotes','admin_invoices','admin_invoice_lines','admin_invoice_checkouts','admin_invoice_webhook_events','admin_unresolved_billing_cases'];
  new_fns text[] := array['admin_propose_quote','admin_withdraw_quote','admin_create_invoice','admin_add_fee_line','admin_add_registration_line','admin_void_line','admin_advance_invoice','company_list_quotes','company_respond_quote','billing_list_invoices','billing_begin_checkout','admin_correct_hire_line','admin_recalculate_registration_line','registration_fee_for_store_count','_admin_tax','_admin_org_billing_actor','_admin_invoice_payable_by','_admin_quotes_rules','_admin_invoice_line_rules','_admin_invoice_requires_amounts','_admin_visit_case_fee_guard','_admin_assert_invoice_correctable'];
begin
  -- 前提（0060・0061）
  insert into pre_log(name, result, info) select '1 前提の関数: ' || f, case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f) then 'PASS' else 'FAIL' end, ''
    from unnest(array['is_platform_admin','admin_create_thread','inbox_reply']) f;
  for rc in select * from (values ('public','salon_organizations','id'),('public','salon_stores','organization_id'),('public','organization_members','role'),('public','platform_admins','user_id'),
      ('public','admin_visit_cases','visit_confirmed_at'),('public','admin_visit_cases','stylist_intent'),('public','admin_visit_cases','salon_intent'),('public','admin_visit_cases','hiring_decision'),('public','admin_audit_events','action')) as x(sch,tbl,col) loop
    insert into pre_log(name, result, info) select '2 前提の表・列: ' || rc.sch || '.' || rc.tbl || '.' || rc.col,
      case when exists (select 1 from information_schema.columns c where c.table_schema = rc.sch and c.table_name = rc.tbl and c.column_name = rc.col) then 'PASS' else 'FAIL' end, '';
  end loop;
  -- 0062 がまだ無い
  insert into pre_log(name, result, info) select '3 0062の表が未作成', case when count(*) = 0 then 'PASS' else 'FAIL' end, coalesce(string_agg(relname, ','), '') from pg_class where relnamespace = 'public'::regnamespace and relname = any (new_tables);
  insert into pre_log(name, result, info) select '4 0062の関数が未作成', case when count(*) = 0 then 'PASS' else 'FAIL' end, coalesce(string_agg(proname, ','), '') from pg_proc where pronamespace = 'public'::regnamespace and proname = any (new_fns);
  insert into pre_log(name, result, info) select '5 admin_visit_cases に請求ガードのトリガーが未作成', case when count(*) = 0 then 'PASS' else 'FAIL' end, '' from pg_trigger where tgname = 'trg_admin_visit_case_fee_guard';
  insert into pre_log(name, result, info) select '6 platform_admins が1件以上', case when count(*) >= 1 then 'PASS' else 'FAIL' end, count(*)::text from public.platform_admins;
  -- 既存の表・関数・トリガーのスナップショット（0062のものを除く）。適用後と同じ値になること
  select md5(string_agg(x, '|' order by x)) into v from (
    select 'tbl:' || c.relname || ':' || coalesce(c.relacl::text, '') as x from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v') and c.relname <> all (new_tables)
    union all select 'fn:' || p.oid::regprocedure::text || ':' || coalesce(p.proacl::text, '') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname <> all (new_fns)
    union all select 'trg:' || c.relname || '.' || t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and c.relname <> all (new_tables) and t.tgname <> 'trg_admin_visit_case_fee_guard'
  ) s;
  insert into pre_log(name, result, info) values ('7 既存オブジェクトのスナップショット（適用後と一致すること）', 'INFO', v);
end $$;
select n, name, result, info from pre_log order by n;
do $$ begin if exists (select 1 from pre_log where result = 'FAIL') then raise exception '適用前チェックに FAIL があります。適用しないでください。'; end if; end $$;
rollback;
