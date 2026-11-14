-- 0062 適用後の確認（何も変更しない。最後にROLLBACK）。実行者は SQLエディタ(postgres)。決済・課金・メール送信は一切行わない。
-- 出力は PASS / FAIL / INFO の表。FAIL が1つでもあれば最後にエラーで止まる。
-- 判定ルール: 「想定した拒否」だけを PASS とする（拒否されなかった／別のエラーは FAIL）。権限エラー(42501)と関数内部の実装エラーは区別する。
begin;
create temp table post_log (n serial, name text, result text, info text);
grant all on post_log to public; grant all on sequence post_log_n_seq to public;
do $$
declare
  v text; msg text; st text; fx record; i int; r jsonb;
  new_tables text[] := array['admin_quotes','admin_invoices','admin_invoice_lines','admin_invoice_checkouts','admin_invoice_webhook_events','admin_unresolved_billing_cases'];
  pub text[] := array['admin_propose_quote','admin_withdraw_quote','admin_create_invoice','admin_add_fee_line','admin_add_registration_line','admin_void_line','admin_advance_invoice','company_list_quotes','company_respond_quote','billing_list_invoices','billing_begin_checkout','admin_correct_hire_line','admin_recalculate_registration_line','admin_flag_billing_case'];
  new_fns text[] := array['admin_propose_quote','admin_withdraw_quote','admin_create_invoice','admin_add_fee_line','admin_add_registration_line','admin_void_line','admin_advance_invoice','company_list_quotes','company_respond_quote','billing_list_invoices','billing_begin_checkout','admin_correct_hire_line','admin_recalculate_registration_line','registration_fee_for_store_count','_admin_tax','_admin_org_billing_actor','_admin_invoice_payable_by','_admin_quotes_rules','_admin_invoice_line_rules','_admin_invoice_requires_amounts','_admin_visit_case_fee_guard','_admin_assert_invoice_correctable','admin_flag_billing_case'];
  calls text[] := array[$q$select public.admin_propose_quote(gen_random_uuid(),100000,'x')$q$,$q$select public.admin_withdraw_quote(gen_random_uuid())$q$,$q$select public.admin_create_invoice(gen_random_uuid())$q$,$q$select public.admin_add_fee_line(gen_random_uuid(),'visit',gen_random_uuid())$q$,$q$select public.admin_add_registration_line(gen_random_uuid())$q$,$q$select public.admin_void_line(gen_random_uuid())$q$,$q$select public.admin_advance_invoice(gen_random_uuid(),'admin_confirmed')$q$,$q$select public.company_list_quotes(gen_random_uuid())$q$,$q$select public.company_respond_quote(gen_random_uuid(),true)$q$,$q$select public.billing_list_invoices(gen_random_uuid())$q$,$q$select public.billing_begin_checkout(gen_random_uuid())$q$,$q$select public.admin_correct_hire_line(gen_random_uuid(),'hire_assistant')$q$,$q$select public.admin_recalculate_registration_line(gen_random_uuid())$q$];
  expected text[] := array['admin access required','admin access required','admin access required','admin access required','admin access required','admin access required','admin access required','not found','not found','not found','not found','admin access required','admin access required'];
begin
  -- 1) 表: 存在・RLS有効・ポリシー無し・所有者以外の権限無し・4ロールの実効権限無し
  insert into post_log(name, result, info) select '1 0062の表が6つ存在', case when count(*) = 6 then 'PASS' else 'FAIL' end, count(*)::text from pg_class where relnamespace = 'public'::regnamespace and relname = any (new_tables) and relkind = 'r';
  insert into post_log(name, result, info) select '1 RLSが有効: ' || relname, case when relrowsecurity then 'PASS' else 'FAIL' end, '' from pg_class where relnamespace = 'public'::regnamespace and relname = any (new_tables);
  insert into post_log(name, result, info) select '1 ポリシーが無い', case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*)::text from pg_policies where schemaname = 'public' and tablename = any (new_tables);
  insert into post_log(name, result, info) select '1 所有者以外の権限付与が無い（表）', case when count(*) = 0 then 'PASS' else 'FAIL' end, coalesce(string_agg(c.relname, ','), '')
    from pg_class c, aclexplode(c.relacl) a where c.relnamespace = 'public'::regnamespace and c.relname = any (new_tables) and a.grantee <> c.relowner;
  insert into post_log(name, result, info) select '1 実効権限なし: ' || rl || ' → ' || tb, case when not (has_table_privilege(rl, 'public.' || tb, 'select,insert,update,delete,truncate,references,trigger') or has_any_column_privilege(rl, 'public.' || tb, 'select,insert,update,references')) then 'PASS' else 'FAIL' end, ''
    from unnest(array['public','anon','authenticated','service_role']) rl, unnest(new_tables) tb;
  -- 2) 関数: 性質と実行権限（付与先を列挙して完全一致）
  for fx in select p2.oid, p2.proname, p2.proowner, p2.prosecdef, coalesce(p2.proconfig::text like '%search_path%', false) as fixed, (p2.proname = any (pub)) as is_pub
              from pg_proc p2 where p2.pronamespace = 'public'::regnamespace and p2.proname = any (new_fns) loop
    select coalesce(string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ',' order by 1), '') into v
      from aclexplode((select proacl from pg_proc where oid = fx.oid)) a where a.privilege_type = 'EXECUTE' and a.grantee <> fx.proowner;
    insert into post_log(name, result, info) values ('2 実行権限の付与先: ' || fx.proname, case when fx.is_pub and v = 'authenticated' then 'PASS' when not fx.is_pub and v = '' then 'PASS' else 'FAIL' end, '付与先(所有者除く)=[' || v || ']');
    if fx.is_pub then insert into post_log(name, result, info) values ('2 SECURITY DEFINER・search_path固定: ' || fx.proname, case when fx.prosecdef and fx.fixed then 'PASS' else 'FAIL' end, ''); end if;
  end loop;
  insert into post_log(name, result, info) select '2 関数が23個存在（公開14＋内部9）', case when count(*) = 23 then 'PASS' else 'FAIL' end, count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = any (new_fns);
  insert into post_log(name, result, info) select '2 service_role は新しい関数を1つも実行できない', case when not bool_or(has_function_privilege('service_role', oid, 'execute')) then 'PASS' else 'FAIL' end, '' from pg_proc where pronamespace = 'public'::regnamespace and proname = any (new_fns);
  -- 3) 規則の仕組み（トリガー・一意制約・同時実行のロック）
  insert into post_log(name, result, info) select '3 トリガー: ' || tg, case when exists (select 1 from pg_trigger where tgname = tg and not tgisinternal) then 'PASS' else 'FAIL' end, ''
    from unnest(array['trg_admin_quotes_rules','trg_admin_invoice_lines_rules','trg_admin_invoices_amounts','trg_admin_visit_case_fee_guard']) tg;
  insert into post_log(name, result, info) select '3 一意制約: ' || ix, case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = ix) then 'PASS' else 'FAIL' end, ''
    from unnest(array['admin_quotes_one_active','admin_invoice_lines_one_per_case_kind','admin_invoice_lines_one_registration','admin_invoice_lines_one_hire_per_case','admin_invoice_lines_one_per_quote','admin_invoice_checkouts_one_live','admin_invoice_lines_one_hire_per_process','admin_invoices_one_request']) ix;
  insert into post_log(name, result, info) select '3 請求ロック: 請求行の規則が請求を共有ロック（for share）', case when pg_get_functiondef('public._admin_invoice_line_rules()'::regprocedure) ilike '%admin_invoices where id = new.invoice_id for share%' then 'PASS' else 'FAIL' end, '';
  insert into post_log(name, result, info) select '3 請求ロック: 確定・取消・決済開始が請求を排他ロック（for update）', case when pg_get_functiondef('public.admin_advance_invoice(uuid,text)'::regprocedure) ilike '%for update%' and pg_get_functiondef('public.billing_begin_checkout(uuid)'::regprocedure) ilike '%for update%' then 'PASS' else 'FAIL' end, '';
  insert into post_log(name, result, info) select '3 見積ロック: 取下げは見積を排他ロック、請求行は共有ロック', case when pg_get_functiondef('public.admin_withdraw_quote(uuid)'::regprocedure) ilike '%for update%' and pg_get_functiondef('public._admin_invoice_line_rules()'::regprocedure) ilike '%admin_quotes q where q.id = new.quote_id for share%' then 'PASS' else 'FAIL' end, '';
  -- 4) 拒否の確認（想定した拒否だけをPASS）
  for i in 1..array_length(calls, 1) loop
    perform set_config('request.jwt.claims', format('{"sub":"%s"}', gen_random_uuid()), true);
    set local role authenticated;
    begin execute calls[i] into r; msg := '拒否されなかった'; st := 'none';
    exception when others then get stacked diagnostics st = returned_sqlstate; msg := sqlerrm; end;
    reset role;
    insert into post_log(name, result, info) values ('4a 一般利用者: ' || left(calls[i], 55), case when st = 'P0001' and msg = expected[i] then 'PASS' else 'FAIL' end, 'sqlstate=' || st || ' msg=' || msg);
    foreach msg in array array['anon','service_role'] loop
      execute 'set local role ' || msg;
      begin execute calls[i]; st := 'none'; exception when others then get stacked diagnostics st = returned_sqlstate; end;
      reset role;
      insert into post_log(name, result, info) values ('4b ' || msg || 'は実行権限なし: ' || left(calls[i], 50), case when st = '42501' then 'PASS' else 'FAIL' end, 'sqlstate=' || st);
    end loop;
  end loop;
  foreach msg in array array['anon','authenticated','service_role'] loop
    foreach v in array new_tables loop
      execute 'set local role ' || msg;
      begin execute 'select 1 from public.' || v || ' limit 1'; st := 'none'; exception when others then get stacked diagnostics st = returned_sqlstate; end;
      reset role;
      insert into post_log(name, result, info) values ('4c ' || msg || ' は表を直接読めない: ' || v, case when st = '42501' then 'PASS' else 'FAIL' end, 'sqlstate=' || st);
    end loop;
  end loop;
  -- 5) 料金規則（読み取りのみ・純関数）: 登録手数料の段階（税抜）と税（10%）。13店舗以上は金額未確定(NULL)
  insert into post_log(name, result, info) select '5 料金規則: 登録手数料の段階と税', case when public.registration_fee_for_store_count(1) = 10000 and public.registration_fee_for_store_count(3) = 10000 and public.registration_fee_for_store_count(4) = 20000
      and public.registration_fee_for_store_count(7) = 30000 and public.registration_fee_for_store_count(10) = 40000 and public.registration_fee_for_store_count(12) = 40000 and public.registration_fee_for_store_count(13) is null
      and public._admin_tax(50000) = 5000 and public._admin_tax(550000) = 55000 and public._admin_tax(450000) = 45000 then 'PASS' else 'FAIL' end, '';
  -- 6) 既存オブジェクトに変化が無い（適用前チェックの7と同じハッシュ）
  select md5(string_agg(x, '|' order by x)) into v from (
    select 'tbl:' || c.relname || ':' || coalesce(c.relacl::text, '') as x from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v') and c.relname <> all (new_tables)
    union all select 'fn:' || p.oid::regprocedure::text || ':' || coalesce(p.proacl::text, '') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname <> all (new_fns)
    union all select 'trg:' || c.relname || '.' || t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and c.relname <> all (new_tables) and t.tgname <> 'trg_admin_visit_case_fee_guard'
  ) s;
  insert into post_log(name, result, info) values ('6 既存オブジェクトのスナップショット（適用前と一致すること）', 'INFO', v);
  -- 7) 定義の指紋（この検証で作ったローカルの値と比較する。0062の関数本体の識別用）
  select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) into v from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (new_fns);
  insert into post_log(name, result, info) values ('7 0062の関数定義の指紋（記録用。ローカル値との一致は別途確認）', 'INFO', v);
end $$;
select n, name, result, info from post_log order by n;
select result, count(*) from post_log group by result order by 1;
do $$ begin if exists (select 1 from post_log where result = 'FAIL') then raise exception '適用後チェックに FAIL があります。停止（0062_suspend_keep_data）を検討してください。'; end if; end $$;
rollback;
