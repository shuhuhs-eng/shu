-- 0063・0064 適用後の確認（何も変更しない。最後にROLLBACK）。0064 の直後に実行する。決済・課金・メール送信は一切行わない。
-- 出力は PASS / FAIL / INFO の表。FAIL が1つでもあれば最後にエラーで止まる（その場合は 0064_suspend_keep_guard 等を検討）。
begin;
create temp table post_log (n serial, name text, result text, info text);
grant all on post_log to public; grant all on sequence post_log_n_seq to public;
do $$
declare t text; f text; c int;
  tbls text[] := array['organization_location_events','organization_billing_regime','hiring_process_billing_basis'];
  pub text[] := array['admin_get_organization_location','admin_set_organization_location','admin_set_billing_regime','admin_set_process_billing_basis','admin_billing_regime_status','is_known_prefecture'];
  internal text[] := array['_billing_append_only','_hiring_lock','_billing_regime_active','_hiring_process_basis','_hiring_has_active_hire_line','_trg_fee_insert_basis','_trg_fee_update_basis','_trg_checkout_basis','_trg_hire_line_regime_guard'];
begin
  foreach t in array tbls loop
    insert into post_log(name, result, info) select '1 表が存在し、RLSが有効: ' || t, case when to_regclass('public.' || t) is not null and (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then 'PASS' else 'FAIL' end, '';
    insert into post_log(name, result, info) select '2 PUBLIC/anon/authenticated/service_role に権限が無い: ' || t,
      case when not exists (select 1 from unnest(array['anon','authenticated','service_role']) ro, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pv where has_table_privilege(ro, ('public.' || t)::regclass, pv))
            and not exists (select 1 from pg_class c, aclexplode(c.relacl) a where c.oid = ('public.' || t)::regclass and a.grantee = 0) then 'PASS' else 'FAIL' end, '';
  end loop;
  foreach f in array pub loop
    insert into post_log(name, result, info) select '3 公開関数は authenticated のみ実行可: ' || f,
      case when (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname = f) >= 1 and not exists (
        select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname = f and (not has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE') or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))) then 'PASS' else 'FAIL' end, '';
  end loop;
  foreach f in array internal loop
    insert into post_log(name, result, info) select '4 内部関数はどのロールにも実行権限が無い: ' || f,
      case when exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname = f) and not exists (
        select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname = f and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE') or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))) then 'PASS' else 'FAIL' end, '';
  end loop;
  insert into post_log(name, result, info) select '5 二重請求防止のトリガー4本＋追記専用トリガー2本が存在', case when (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_admin_invoice_lines_regime_guard','trg_stripe_checkout_basis','trg_hiring_success_fees_basis_update','trg_hiring_success_fees_basis_insert','trg_regime_append_only','trg_basis_append_only')) = 6 then 'PASS' else 'FAIL' end, '';
  insert into post_log(name, result, info) select '6 適用直後は切替の記録・案件ごとの判定が0件（料金方式はまだ切り替わっていない）', case when (select count(*) from public.organization_billing_regime) = 0 and (select count(*) from public.hiring_process_billing_basis) = 0 then 'PASS' else 'FAIL' end,
    (select count(*) from public.organization_billing_regime)::text || '/' || (select count(*) from public.hiring_process_billing_basis)::text;
  insert into post_log(name, result, info) select '7 会社所在地は全社 未設定（店舗住所から推測して埋めていない）', case when (select count(*) from public.salon_organizations where hq_prefecture is not null or hq_city is not null or hq_street_address is not null) = 0 then 'PASS' else 'FAIL' end, '';
  insert into post_log(name, result, info) select '8 料金方式の判定: 切替の記録が無い会社の案件はすべて旧（新方式の案件は0件）', case when not exists (select 1 from public.store_hiring_processes p where public._hiring_process_basis(p.id) = 'new') then 'PASS' else 'FAIL' end, '';
  insert into post_log(name, result, info) select '9 整合性チェック（0040）に0064の1行が反映されている', case when pg_get_functiondef('public.get_admin_billing_integrity_issues()'::regprocedure) like '%_hiring_process_basis%' then 'PASS' else 'FAIL' end, '';
  insert into post_log(name, result, info) select '10 整合性チェックの権限は従来どおり（authenticatedのみ。anon不可）', case when has_function_privilege('authenticated','public.get_admin_billing_integrity_issues()','EXECUTE') and not has_function_privilege('anon','public.get_admin_billing_integrity_issues()','EXECUTE') then 'PASS' else 'FAIL' end, '';
  -- 想定した拒否（権限）
  begin set local role anon; perform public.admin_set_billing_regime(gen_random_uuid(), now()); insert into post_log(name, result, info) values ('11 anon は切替を実行できない', 'FAIL', '実行できてしまった'); reset role;
  exception when others then reset role; insert into post_log(name, result, info) values ('11 anon は切替を実行できない', case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlerrm); end;
  begin set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid())::text, true); perform public.admin_set_billing_regime(gen_random_uuid(), now()); insert into post_log(name, result, info) values ('12 運営者以外は切替を実行できない', 'FAIL', '実行できてしまった'); reset role;
  exception when others then reset role; insert into post_log(name, result, info) values ('12 運営者以外は切替を実行できない', case when sqlerrm = 'admin access required' then 'PASS' else 'FAIL' end, sqlerrm); end;
  -- 既存データを変更していない（適用前の記録と目視で一致を確認）
  insert into post_log(name, result, info) select '13 旧成功報酬の件数・状態別（適用前と一致すること）', 'INFO', coalesce((select string_agg(fee_status || '=' || n, ',' order by fee_status) from (select fee_status, count(*) n from public.hiring_success_fees group by 1) s), '0件');
  insert into post_log(name, result, info) select '13 stripe_checkout_records の件数（適用前と一致すること）', 'INFO', (select count(*)::text from public.stripe_checkout_records);
end $$;
select n, name, result, info from post_log order by n;
select result, count(*) from post_log group by 1 order by 1;
do $$ begin if exists (select 1 from post_log where result = 'FAIL') then raise exception '適用後チェックに FAIL があります。0064_suspend_keep_guard の実行を検討してください。'; end if; end $$;
rollback;
