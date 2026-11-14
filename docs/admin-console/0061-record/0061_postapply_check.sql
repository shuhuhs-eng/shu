-- 0061 適用後の確認（何も変更しない。最後にROLLBACK）。実行者は SQLエディタ(postgres)。
-- 出力は PASS / FAIL / SKIP の表。FAIL が1つでもあれば最後にエラーで止まる。
-- 判定ルール: 「想定した拒否」だけを PASS とする（拒否されなかった／別のエラーは FAIL）。権限エラー(42501)と関数内部の実装エラーは区別する。
begin;
create temp table post_log (n serial, name text, result text, info text);
grant all on post_log to public; grant all on sequence post_log_n_seq to public;
do $$
declare
  v text; rc record; msg text; st text;
  new_tables text[] := array['admin_audit_events','admin_visit_cases','admin_threads','admin_messages','admin_message_deliveries','account_invitations','account_invitation_events','salon_inquiries'];
  new_fns text[] := array['admin_create_thread','admin_post_message','admin_set_thread_status','admin_list_threads','admin_get_thread','admin_record_delivery','inbox_list_threads','inbox_get_thread','inbox_reply',
    '_admin_salon_access','_admin_thread_visible_to','_admin_inbox_can_see','_admin_threads_consistency','_admin_messages_rules','_admin_request_hash','_admin_lock_sender','_admin_lock_request'];
  pub text[] := array['admin_create_thread','admin_post_message','admin_set_thread_status','admin_list_threads','admin_get_thread','admin_record_delivery','inbox_list_threads','inbox_get_thread','inbox_reply'];
  calls text[] := array[
    $q$select public.admin_create_thread(gen_random_uuid(),'salon',null,gen_random_uuid(),null,null,'x','b')$q$, $q$select public.admin_post_message(gen_random_uuid(),gen_random_uuid(),'internal_note','x')$q$,
    $q$select public.admin_set_thread_status(gen_random_uuid(),'done')$q$, $q$select public.admin_list_threads()$q$, $q$select public.admin_get_thread(gen_random_uuid())$q$,
    $q$select public.admin_record_delivery(gen_random_uuid(),'sent')$q$, $q$select public.inbox_list_threads()$q$, $q$select public.inbox_get_thread(gen_random_uuid())$q$,
    $q$select public.inbox_reply(gen_random_uuid(),gen_random_uuid(),'x')$q$];
  expected_for_user text[] := array['admin access required','admin access required','admin access required','admin access required','admin access required','admin access required', null,'thread not found','thread not found'];
  fx record; i int; adm uuid; r jsonb;
begin
  -- 1) 表: 存在・RLS有効・ポリシー無し・所有者以外の権限無し（表・列）・4ロールの実効権限無し
  insert into post_log(name, result, info) select '1 0061の表が8つ存在', case when count(*) = 8 then 'PASS' else 'FAIL' end, count(*)::text from pg_class where relnamespace = 'public'::regnamespace and relname = any (new_tables) and relkind = 'r';
  insert into post_log(name, result, info) select '1 RLSが有効: ' || relname, case when relrowsecurity then 'PASS' else 'FAIL' end, '' from pg_class where relnamespace = 'public'::regnamespace and relname = any (new_tables);
  insert into post_log(name, result, info) select '1 ポリシーが無い（ブラウザからの直接アクセスは全拒否）', case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*)::text from pg_policies where schemaname = 'public' and tablename = any (new_tables);
  insert into post_log(name, result, info) select '1 所有者以外の権限付与が無い（表）', case when count(*) = 0 then 'PASS' else 'FAIL' end, coalesce(string_agg(c.relname || '→' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ','), '')
    from pg_class c, aclexplode(c.relacl) a where c.relnamespace = 'public'::regnamespace and c.relname = any (new_tables) and a.grantee <> c.relowner;
  insert into post_log(name, result, info) select '1 列単位の権限付与が無い', case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*)::text
    from pg_attribute at join pg_class c on c.oid = at.attrelid where c.relnamespace = 'public'::regnamespace and c.relname = any (new_tables) and at.attacl is not null;
  insert into post_log(name, result, info) select '1 実効権限なし: ' || rl || ' → ' || tb, case when not (has_table_privilege(rl, 'public.' || tb, 'select,insert,update,delete,truncate,references,trigger') or has_any_column_privilege(rl, 'public.' || tb, 'select,insert,update,references')) then 'PASS' else 'FAIL' end, ''
    from unnest(array['public','anon','authenticated','service_role']) rl, unnest(new_tables) tb;
  -- 2) 関数: 性質と実行権限（付与先を列挙して完全一致）
  for fx in select p2.oid, p2.proname, p2.proowner, p2.prosecdef, coalesce(p2.proconfig::text like '%search_path%', false) as fixed, (p2.proname = any (pub)) as is_pub from pg_proc p2 where p2.pronamespace = 'public'::regnamespace and p2.proname = any (new_fns) loop
    select coalesce(string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ',' order by 1), '') into v from aclexplode((select proacl from pg_proc where oid = fx.oid)) a where a.privilege_type = 'EXECUTE' and a.grantee <> fx.proowner;
    insert into post_log(name, result, info) values ('2 実行権限の付与先: ' || fx.proname, case when fx.is_pub and v = 'authenticated' then 'PASS' when not fx.is_pub and v = '' then 'PASS' else 'FAIL' end, '付与先(所有者除く)=[' || v || ']');
    if fx.is_pub then insert into post_log(name, result, info) values ('2 SECURITY DEFINER・search_path固定: ' || fx.proname, case when fx.prosecdef and fx.fixed then 'PASS' else 'FAIL' end, ''); end if;
  end loop;
  insert into post_log(name, result, info) select '2 関数が17個存在', case when count(*) = 17 then 'PASS' else 'FAIL' end, count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = any (new_fns);
  insert into post_log(name, result, info) select '2 service_role は新しい関数を1つも実行できない', case when not bool_or(has_function_privilege('service_role', oid, 'execute')) then 'PASS' else 'FAIL' end, '' from pg_proc where pronamespace = 'public'::regnamespace and proname = any (new_fns);
  -- 3) 整合・冪等性の仕組み（トリガー・一意制約）
  insert into post_log(name, result, info) select '3 トリガー: ' || tg, case when exists (select 1 from pg_trigger where tgname = tg and not tgisinternal) then 'PASS' else 'FAIL' end, '' from unnest(array['trg_admin_threads_consistency','trg_admin_messages_rules']) tg;
  insert into post_log(name, result, info) select '3 一意制約: ' || ix, case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = ix) then 'PASS' else 'FAIL' end, '' from unnest(array['admin_messages_one_request','admin_visit_cases_one_open','account_invitations_one_active']) ix;
  insert into post_log(name, result, info) select '3 通知は1メッセージ1件（unique）', case when exists (select 1 from pg_constraint where conrelid = 'public.admin_message_deliveries'::regclass and contype = 'u') then 'PASS' else 'FAIL' end, '';
  -- 4) 拒否の確認（想定した拒否だけをPASS）
  for i in 1..array_length(calls, 1) loop
    perform set_config('request.jwt.claims', format('{"sub":"%s"}', gen_random_uuid()), true);
    set local role authenticated;
    begin execute calls[i] into r; msg := '拒否されなかった'; st := 'none'; if expected_for_user[i] is null and r ? 'total' then msg := 'OK(空)'; st := 'ok'; end if;
    exception when others then get stacked diagnostics st = returned_sqlstate; msg := sqlerrm; end;
    reset role;
    insert into post_log(name, result, info) values ('4a 一般利用者: ' || left(calls[i], 55),
      case when expected_for_user[i] is null then (case when st = 'ok' then 'PASS' else 'FAIL' end) when st = 'P0001' and msg = expected_for_user[i] then 'PASS' else 'FAIL' end, 'sqlstate=' || st || ' msg=' || msg);
    foreach msg in array array['anon','service_role'] loop
      execute 'set local role ' || msg;
      begin execute calls[i]; st := 'none'; exception when others then get stacked diagnostics st = returned_sqlstate; end;
      reset role;
      insert into post_log(name, result, info) values ('4b ' || msg || 'は実行権限なし: ' || left(calls[i], 50), case when st = '42501' then 'PASS' else 'FAIL' end, 'sqlstate=' || st);
    end loop;
  end loop;
  -- 4c) 表への直接アクセスが 42501（anon / authenticated / service_role）
  foreach msg in array array['anon','authenticated','service_role'] loop
    foreach v in array array['admin_threads','admin_messages','admin_message_deliveries','account_invitations'] loop
      execute 'set local role ' || msg;
      begin execute 'select 1 from public.' || v || ' limit 1'; st := 'none'; exception when others then get stacked diagnostics st = returned_sqlstate; end;
      reset role;
      insert into post_log(name, result, info) values ('4c ' || msg || ' は表を直接読めない: ' || v, case when st = '42501' then 'PASS' else 'FAIL' end, 'sqlstate=' || st);
    end loop;
  end loop;
  -- 5) 運営者としての動作（登録済み運営者のIDを借りた読み取り。件数のみ）
  select user_id into adm from public.platform_admins order by user_id limit 1;
  if adm is null then insert into post_log(name, result, info) values ('5 運営者での動作', 'SKIP', 'platform_admins が0件のため確認できない');
  else
    perform set_config('request.jwt.claims', format('{"sub":"%s"}', adm), true);
    set local role authenticated;
    begin r := public.admin_list_threads(); insert into post_log(name, result, info) values ('5 運営者: 連絡一覧が返る', case when r ? 'total' and r ? 'rows' then 'PASS' else 'FAIL' end, 'total=' || (r->>'total'));
    exception when others then get stacked diagnostics st = returned_sqlstate; insert into post_log(name, result, info) values ('5 運営者: 連絡一覧', 'FAIL', 'sqlstate=' || st || ' ' || sqlerrm); end;
    reset role;
  end if;
  -- 6) 既存オブジェクトに変化が無い（適用前チェックの7と同じハッシュ）
  
  select md5(string_agg(x, '|' order by x)) into v from (
    select 'tbl:' || c.relname || ':' || coalesce(c.relacl::text, '') as x from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v') and c.relname <> all (new_tables)
    union all select 'fn:' || p.oid::regprocedure::text || ':' || coalesce(p.proacl::text, '') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname <> all (new_fns)
    union all select 'trg:' || c.relname || '.' || t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and c.relname <> all (new_tables)
  ) s;
  insert into post_log(name, result, info) values ('6 既存オブジェクトのスナップショット（適用前と一致すること）', 'INFO', v);
end $$;
select n, name, result, info from post_log order by n;
select result, count(*) from post_log group by result order by 1;
do $$ begin if exists (select 1 from post_log where result = 'FAIL') then raise exception '適用後チェックに FAIL があります。停止（0061_suspend_keep_data）を検討してください。'; end if; end $$;
rollback;
