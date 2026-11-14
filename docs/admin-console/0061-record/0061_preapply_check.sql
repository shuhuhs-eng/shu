-- 0061 適用前の確認（読み取り専用。何も変更しない）。0060 の適用後に、0061 の直前に実行する。
-- 出力は PASS / FAIL の表。FAIL が1つでもあれば最後にエラーで止まる。FAIL のまま適用しない。
begin;
create temp table pre_log (n serial, name text, result text, info text);
do $$
declare
  v text; rc record; msg text; st text;
  new_tables text[] := array['admin_audit_events','admin_visit_cases','admin_threads','admin_messages','admin_message_deliveries','account_invitations','account_invitation_events','salon_inquiries'];
  new_fns text[] := array['admin_create_thread','admin_post_message','admin_set_thread_status','admin_list_threads','admin_get_thread','admin_record_delivery','inbox_list_threads','inbox_get_thread','inbox_reply',
    '_admin_salon_access','_admin_thread_visible_to','_admin_inbox_can_see','_admin_threads_consistency','_admin_messages_rules','_admin_request_hash','_admin_lock_sender','_admin_lock_request'];
begin
  -- 前提（0060 など）
  insert into pre_log(name, result, info) select '1 前提の関数: ' || f, case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f) then 'PASS' else 'FAIL' end, ''
    from unnest(array['is_platform_admin','_admin_is_stylist_account','_admin_known_prefectures']) f;
  for rc in select * from (values ('public','salon_organizations','id'),('public','salon_stores','organization_id'),('public','organization_members','role'),('public','store_members','role'),
      ('public','store_hiring_processes','id'),('public','platform_admins','user_id'),('public','user_roles','role'),('public','profiles','role'),('auth','users','raw_user_meta_data')) as x(sch,tbl,col) loop
    insert into pre_log(name, result, info) select '2 前提の表・列: ' || rc.sch || '.' || rc.tbl || '.' || rc.col,
      case when exists (select 1 from information_schema.columns c where c.table_schema = rc.sch and c.table_name = rc.tbl and c.column_name = rc.col) then 'PASS' else 'FAIL' end, '';
  end loop;
  insert into pre_log(name, result, info) select '3 gen_random_uuid / advisory lock が使える', case when has_function_privilege('gen_random_uuid()', 'execute') and has_function_privilege('pg_advisory_xact_lock(bigint)', 'execute') then 'PASS' else 'FAIL' end, '';
  -- 0061 がまだ無い
  insert into pre_log(name, result, info) select '4 0061の表が未作成', case when count(*) = 0 then 'PASS' else 'FAIL' end, string_agg(relname, ',') from pg_class where relnamespace = 'public'::regnamespace and relname = any (new_tables);
  insert into pre_log(name, result, info) select '5 0061の関数が未作成', case when count(*) = 0 then 'PASS' else 'FAIL' end, string_agg(proname, ',') from pg_proc where pronamespace = 'public'::regnamespace and proname = any (new_fns);
  insert into pre_log(name, result, info) select '6 platform_admins が1件以上', case when count(*) >= 1 then 'PASS' else 'FAIL' end, count(*)::text from public.platform_admins;
  -- 既存の表・関数・トリガーのスナップショット（0061のものを除く）。適用後と同じ値になること
  
  select md5(string_agg(x, '|' order by x)) into v from (
    select 'tbl:' || c.relname || ':' || coalesce(c.relacl::text, '') as x from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v') and c.relname <> all (new_tables)
    union all select 'fn:' || p.oid::regprocedure::text || ':' || coalesce(p.proacl::text, '') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname <> all (new_fns)
    union all select 'trg:' || c.relname || '.' || t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and c.relname <> all (new_tables)
  ) s;
  insert into pre_log(name, result, info) values ('7 既存オブジェクトのスナップショット（適用後と一致すること）', 'INFO', v);
end $$;
select n, name, result, info from pre_log order by n;
do $$ begin if exists (select 1 from pre_log where result = 'FAIL') then raise exception '適用前チェックに FAIL があります。適用しないでください。'; end if; end $$;
rollback;
